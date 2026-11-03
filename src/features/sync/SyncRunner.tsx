import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useSettings } from '../../api/hooks';
import { onBeforeBackground } from '../../lib/native';
import { dropboxAvailable } from './dropbox';
import { syncNow } from './syncEngine';

/** Background sync: on open, shortly after changes, and before the app goes to the background. */
export function SyncRunner() {
  const settings = useSettings();
  const qc = useQueryClient();
  const enabled = dropboxAvailable() && settings.data?.['sync.enabled'] === true;
  const dirty = settings.data?.['sync.dirty'] === true;
  const running = useRef(false);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    try {
      const r = await syncNow();
      if (r === 'downloaded') await qc.invalidateQueries();
      else await qc.invalidateQueries({ queryKey: ['settings'] });
    } catch {
      // Offline or Dropbox unavailable: try again later. Status is shown in Settings.
    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    if (enabled) void run();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !dirty) return;
    const h = window.setTimeout(() => void run(), 20_000);
    return () => window.clearTimeout(h);
  }, [enabled, dirty, settings.dataUpdatedAt]);

  useEffect(() => {
    if (!enabled) return;
    return onBeforeBackground(async () => {
      if (dirty) await run();
    });
  }, [enabled, dirty]);

  return null;
}
