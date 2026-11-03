import { call } from '../../api/client';
import type { Settings } from '../../api/types';
import { download, remoteRev, upload } from './dropbox';

export type SyncOutcome = 'up_to_date' | 'uploaded' | 'downloaded' | 'conflict';

/**
 * One sync pass. Rules: newest copy wins; if both this phone and Dropbox changed since the
 * last sync, nothing is overwritten and the user chooses.
 */
export async function syncNow(force?: 'keep_local' | 'keep_remote'): Promise<SyncOutcome> {
  const s = await call<Settings>('settings.all');
  const lastRev = s['sync.last_rev'] || null;
  const dirty = s['sync.dirty'] === true;
  const rev = await remoteRev();

  const push = async (expect: string | null) => {
    const { data_b64 } = await call<{ data_b64: string }>('sync.export');
    const r = await upload(data_b64, expect);
    if (r === 'conflict') return 'conflict' as const;
    await call('sync.mark_uploaded', { rev: r.rev });
    return 'uploaded' as const;
  };
  const pull = async () => {
    const f = await download();
    await call('sync.import', { data_b64: f.data, rev: f.rev });
    return 'downloaded' as const;
  };

  if (force === 'keep_local') return push(null);
  if (force === 'keep_remote') return pull();
  if (rev === null) return push(null);
  if (rev === lastRev) return dirty ? push(lastRev) : 'up_to_date';
  if (!dirty) return pull();
  return 'conflict';
}
