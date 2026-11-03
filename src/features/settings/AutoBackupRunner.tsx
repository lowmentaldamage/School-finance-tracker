import { useEffect, useRef } from 'react';

import { call } from '../../api/client';
import { useSettings } from '../../api/hooks';
import type { FileData } from '../../api/types';
import { isAndroidApp, native } from '../../lib/native';

const WEEK_MS = 7 * 24 * 3600 * 1000;
const KEEP = 5;

export async function runAutoBackup(folderUri: string): Promise<void> {
  const f = await call<FileData>('autobackup.create');
  await native('writeToFolder', { uri: folderUri, name: f.file_name, mime: 'application/octet-stream', data: f.data_b64 });
  const listed = await native<{ files: string }>('listFolder', { uri: folderUri });
  const files = (JSON.parse(listed.files) as Array<{ name: string; modified: number }>)
    .filter((x) => /^keel-auto-.*\.keelbak$/.test(x.name))
    .sort((a, b) => b.modified - a.modified);
  for (const old of files.slice(KEEP)) await native('deleteInFolder', { uri: folderUri, name: old.name });
}

/** Weekly automatic backup, run when the app is opened and unlocked. */
export function AutoBackupRunner() {
  const settings = useSettings();
  const done = useRef(false);
  const s = settings.data;
  useEffect(() => {
    if (done.current || !s || !isAndroidApp()) return;
    if (s['backup.auto.enabled'] !== true || !s['backup.auto.folder_uri']) return;
    const last = s['backup.auto.last_at'] ? Date.parse(s['backup.auto.last_at']) : 0;
    if (Date.now() - last < WEEK_MS) return;
    done.current = true;
    void runAutoBackup(s['backup.auto.folder_uri']).catch(() => {
      done.current = false;
    });
  }, [s]);
  return null;
}
