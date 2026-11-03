import { useEffect, useRef } from 'react';

import { call } from '../../api/client';
import { useResetAfterSessionChange, useSettings } from '../../api/hooks';
import type { AppStatus } from '../../api/types';
import { backgroundLockPaused, runBeforeBackground } from '../../lib/native';
import { setSecureWindow } from '../../lib/platform';

/**
 * Locks after a period without interaction, and when the app has been in the background
 * longer than the configured grace period. Also applies the "hide in app switcher" setting.
 */
export function AutoLock({ status }: { status: AppStatus }) {
  const settings = useSettings();
  const reset = useResetAfterSessionChange();
  const enabled = !!status.lock && status.ready;
  const minutes = settings.data?.['security.auto_lock_minutes'] ?? 5;
  const graceSecs = settings.data?.['security.background_lock_secs'] ?? 0;
  const hide = settings.data?.['security.hide_in_switcher'] ?? false;
  const last = useRef(Date.now());
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    void setSecureWindow(hide).catch(() => undefined);
  }, [hide]);

  useEffect(() => {
    if (!enabled) return;
    const lockNow = async () => {
      try {
        await call('session.lock');
      } finally {
        await reset();
      }
    };
    const touch = () => {
      last.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - last.current >= minutes * 60_000) void lockNow();
    }, 15_000);
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (backgroundLockPaused()) {
          hiddenAt.current = null;
          return;
        }
        if (graceSecs === 0) void runBeforeBackground().then(lockNow);
      } else if (hiddenAt.current !== null) {
        const away = (Date.now() - hiddenAt.current) / 1000;
        hiddenAt.current = null;
        if (away >= graceSecs && !backgroundLockPaused()) void lockNow();
        else touch();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, minutes, graceSecs]);

  return null;
}
