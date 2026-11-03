import { invokeNative, isTauri } from '../api/client';

/** Save bytes to a user-chosen location. Returns false if the user cancelled. */
export async function saveFile(name: string, mime: string, dataB64: string): Promise<boolean> {
  if (isTauri()) {
    const r = await invokeNative<{ saved: boolean }>('save_file', { args: { name, mime, data_b64: dataB64 } });
    return r.saved;
  }
  const bin = atob(dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Let the user pick a file. Resolves to base64 contents, or null if cancelled. */
export async function pickFile(accept = '.keelbak,application/octet-stream'): Promise<string | null> {
  if (isTauri()) {
    const r = await invokeNative<{ data: string }>('open_file');
    return r.data ? r.data : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result ?? '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(f);
    };
    input.click();
  });
}

/** Android: hide app content in the recent-apps switcher and block screenshots. */
export async function setSecureWindow(enabled: boolean): Promise<void> {
  if (isTauri()) await invokeNative('set_secure', { enabled });
}
