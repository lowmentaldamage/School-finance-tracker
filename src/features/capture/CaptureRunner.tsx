import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { call } from '../../api/client';
import { useAccounts, useSetSetting, useSettings } from '../../api/hooks';
import type { CaptureIngestResult } from '../../api/types';
import { useToast } from '../../components/ui';
import { isAndroidApp, native } from '../../lib/native';

const POLL_MS = 5000;

/** Banks set up automatically as soon as they show a payment notification. */
export const KNOWN_BANKS = /revolut|\bnlb\b|nlb ?klik/i;

/**
 * While Keel is open and unlocked, moves bank notifications captured by the phone into the
 * encrypted database (every few seconds and whenever the app comes to the front).
 */
export function CaptureRunner() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useSettings();
  const enabled = settings.data?.['capture.enabled'] === true;
  const apps = settings.data?.['capture.apps'] ?? [];
  const packages = JSON.stringify(apps.map((a) => a.package));
  const busy = useRef(false);
  const setSetting = useSetSetting();
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const defaultAccount = active.find((a) => a.currency === 'EUR') ?? active[0];

  // Add Revolut / NLB to the list of read apps once the phone has seen them.
  useEffect(() => {
    if (!isAndroidApp() || !enabled || !settings.isSuccess || !accounts.isSuccess) return;
    let stop = false;
    async function check() {
      try {
        const r = await native<{ seen: string }>('captureStatus');
        const seen: Array<{ package: string; label: string }> = JSON.parse(r.seen);
        const current = settings.data?.['capture.apps'] ?? [];
        const add = seen.filter((s) => (KNOWN_BANKS.test(s.label) || KNOWN_BANKS.test(s.package)) && !current.some((a) => a.package === s.package));
        if (!stop && add.length)
          setSetting.mutate({
            key: 'capture.apps',
            value: [...current, ...add.map((s) => ({ package: s.package, label: (s.label || s.package).slice(0, 120), account_id: active.length === 1 ? defaultAccount!.id : null, auto_add: false }))],
          });
      } catch {
        // Not available.
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [enabled, settings.data, accounts.isSuccess]);

  // Tell the phone's listener which apps to read.
  useEffect(() => {
    if (!isAndroidApp() || !settings.isSuccess) return;
    void native('captureConfigure', { enabled, packages }).catch(() => undefined);
  }, [enabled, packages, settings.isSuccess]);

  useEffect(() => {
    if (!isAndroidApp() || !enabled) return;
    async function run() {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const r = await native<{ items: string; lines: number }>('captureDrain');
        if (!r.lines) return;
        const items: unknown[] = JSON.parse(r.items);
        const res = items.length ? await call<CaptureIngestResult>('captures.ingest', { items }) : null;
        await native('captureAck', { lines: r.lines });
        if (!res) return;
        if (res.added > 0) {
          for (const k of ['accounts', 'transactions', 'reports', 'budgets', 'goals', 'payees']) void qc.invalidateQueries({ queryKey: [k] });
          toast(t('capture.added_auto', { count: res.added }));
        }
        if (res.pending > 0) toast(t('capture.new', { count: res.pending }));
        if (res.added > 0 || res.pending > 0) void qc.invalidateQueries({ queryKey: ['captures'] });
      } catch {
        // Locked or busy: the queue stays on the phone and is read next time.
      } finally {
        busy.current = false;
      }
    }
    void run();
    const timer = window.setInterval(() => void run(), POLL_MS);
    const onVisible = () => !document.hidden && void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return null;
}
