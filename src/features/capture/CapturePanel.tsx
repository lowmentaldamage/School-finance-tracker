import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAccounts, useSetSetting, useSettings } from '../../api/hooks';
import type { CaptureApp } from '../../api/types';
import { Button, Checkbox, Icon, Panel, Select } from '../../components/ui';
import { isAndroidApp, native, pauseBackgroundLock } from '../../lib/native';

interface NativeStatus {
  access: boolean;
  enabled: boolean;
  seen: Array<{ package: string; label: string }>;
}

async function readStatus(): Promise<NativeStatus | null> {
  try {
    const r = await native<{ access: boolean; enabled: boolean; seen: string }>('captureStatus');
    return { access: r.access, enabled: r.enabled, seen: JSON.parse(r.seen) };
  } catch {
    return null;
  }
}

export function CapturePanel() {
  const { t } = useTranslation();
  const settings = useSettings();
  const set = useSetSetting();
  const accounts = useAccounts();
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const android = isAndroidApp();

  useEffect(() => {
    if (!android) return;
    const refresh = () => !document.hidden && void readStatus().then(setStatus);
    refresh();
    // Re-check when coming back from Android settings.
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 4000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [android]);

  if (!android) return null;
  const enabled = settings.data?.['capture.enabled'] === true;
  const apps: CaptureApp[] = settings.data?.['capture.apps'] ?? [];
  const candidates = [
    ...apps.map((a) => ({ package: a.package, label: a.label })),
    ...(status?.seen ?? []).filter((s) => !apps.some((a) => a.package === s.package)),
  ];
  const active = (accounts.data ?? []).filter((a) => !a.archived);

  function saveApps(next: CaptureApp[]) {
    set.mutate({ key: 'capture.apps', value: next });
  }

  function toggleApp(pkg: string, label: string, on: boolean) {
    if (on) saveApps([...apps, { package: pkg, label: label.slice(0, 120), account_id: active.length === 1 ? active[0]!.id : null, auto_add: false }]);
    else saveApps(apps.filter((a) => a.package !== pkg));
  }

  function updateApp(pkg: string, patch: Partial<CaptureApp>) {
    saveApps(apps.map((a) => (a.package === pkg ? { ...a, ...patch } : a)));
  }

  async function openSettings(method: 'captureOpenAccess' | 'openAppInfo') {
    // Visiting Android settings must not lock the app.
    pauseBackgroundLock(120_000);
    await native(method).catch(() => undefined);
  }

  return (
    <Panel title={t('capture.title')}>
      <div className="flex flex-col gap-4 px-4 py-4">
        <p className="text-[12.5px] text-muted">{t('capture.intro')}</p>
        <Checkbox label={t('capture.enable')} checked={enabled} onChange={(e) => set.mutate({ key: 'capture.enabled', value: e.target.checked })} />

        {enabled && status && !status.access && (
          <div role="status" className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-3 text-[13px] text-warning">
            <div className="flex items-center gap-2 font-medium">
              <Icon name="alert" />
              {t('capture.access_needed')}
            </div>
            <p>{t('capture.access_hint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void openSettings('captureOpenAccess')}>
                {t('capture.grant')}
              </Button>
              <Button size="sm" onClick={() => void openSettings('openAppInfo')}>
                {t('capture.app_info')}
              </Button>
            </div>
            <p className="text-[12px]">{t('capture.restricted_hint')}</p>
          </div>
        )}

        {enabled && status?.access && (
          <>
            <p className="flex items-center gap-1.5 text-[12.5px] text-positive">
              <Icon name="check" />
              {t('capture.access_ok')}
            </p>
            <div>
              <div className="text-sm font-medium text-text">{t('capture.apps')}</div>
              <p className="mt-0.5 text-[12.5px] text-muted">{candidates.length ? t('capture.apps_hint') : t('capture.no_apps')}</p>
            </div>
            <ul className="flex flex-col gap-3">
              {candidates.map((c) => {
                const app = apps.find((a) => a.package === c.package);
                return (
                  <li key={c.package} className="rounded-md border border-border px-3 py-3">
                    <Checkbox label={c.label || c.package} checked={!!app} onChange={(e) => toggleApp(c.package, c.label || c.package, e.target.checked)} />
                    {app && (
                      <div className="mt-3 flex flex-col gap-3 pl-6">
                        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                          {t('capture.account')}
                          <Select
                            value={app.account_id ?? ''}
                            onChange={(e) => updateApp(app.package, { account_id: e.target.value || null, ...(e.target.value ? {} : { auto_add: false }) })}
                          >
                            <option value="">{t('capture.ask')}</option>
                            {active.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({a.currency})
                              </option>
                            ))}
                          </Select>
                        </label>
                        <div>
                          <Checkbox
                            label={t('capture.auto_add')}
                            checked={app.auto_add}
                            disabled={!app.account_id}
                            onChange={(e) => updateApp(app.package, { auto_add: e.target.checked })}
                          />
                          <p className="mt-0.5 pl-6 text-[12px] text-muted">{t('capture.auto_add_hint')}</p>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
