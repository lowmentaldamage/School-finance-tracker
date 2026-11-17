import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { call } from '../../api/client';
import { useSettings } from '../../api/hooks';
import type { CaptureIngestResult } from '../../api/types';
import { useToast } from '../../components/ui';
import { isAndroidApp, native } from '../../lib/native';

const POLL_MS = 5000;

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
