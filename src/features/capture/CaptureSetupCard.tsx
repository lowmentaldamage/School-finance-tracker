import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSetSetting, useSettings } from '../../api/hooks';
import { Button, Icon, Panel } from '../../components/ui';
import { isAndroidApp, native, pauseBackgroundLock } from '../../lib/native';

const DISMISS_KEY = 'keel.capture.setup_dismissed';

/** One-tap setup on the Overview: turn on bank notifications and grant Android access. */
export function CaptureSetupCard() {
  const { t } = useTranslation();
  const settings = useSettings();
  const set = useSetSetting();
  const [access, setAccess] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const android = isAndroidApp();
  const enabled = settings.data?.['capture.enabled'] === true;

  useEffect(() => {
    if (!android) return;
    const refresh = () =>
      !document.hidden &&
      void native<{ access: boolean }>('captureStatus')
        .then((r) => setAccess(r.access))
        .catch(() => setAccess(null));
    refresh();
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 4000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [android]);

  if (!android || access === null || (enabled && access)) return null;
  if (!enabled && dismissed) return null;

  async function open(method: 'captureOpenAccess' | 'openAppInfo') {
    pauseBackgroundLock(120_000);
    await native(method).catch(() => undefined);
  }

  async function start() {
    if (!enabled) await set.mutateAsync({ key: 'capture.enabled', value: true });
    if (!access) await open('captureOpenAccess');
  }

  function notNow() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Ignore.
    }
    setDismissed(true);
  }

  return (
    <Panel title={t('capture.setup_title')}>
      <div className="flex flex-col gap-3 px-4 py-4 text-[13px]">
        <p className="text-muted">{t('capture.setup_body')}</p>
        {enabled && !access && (
          <p className="flex items-start gap-2 text-warning">
            <Icon name="alert" className="mt-0.5 shrink-0" />
            {t('capture.restricted_hint')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void start()}>
            {enabled ? t('capture.grant') : t('capture.setup_button')}
          </Button>
          {enabled && <Button onClick={() => void open('openAppInfo')}>{t('capture.app_info')}</Button>}
          {!enabled && (
            <Button variant="ghost" onClick={notNow}>
              {t('capture.not_now')}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
