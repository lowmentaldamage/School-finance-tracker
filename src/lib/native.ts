import { invokeNative, isTauri } from '../api/client';

/** True inside the Android app (native services available). */
export const isAndroidApp = (): boolean => isTauri() && /Android/i.test(navigator.userAgent);

/** Call an allow-listed native Android service (see src-tauri/src/lib.rs NATIVE_METHODS). */
export function native<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return invokeNative<T>('native_call', { method, args });
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const textToB64 = (t: string) => toB64(new TextEncoder().encode(t));
export const b64ToText = (b: string) => new TextDecoder().decode(fromB64(b));

/** Stable positive 31-bit id from a string (notification ids). */
export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}

/** While set, leaving the app does not lock it (used during Dropbox sign-in in the browser). */
let backgroundLockPausedUntil = 0;
export const pauseBackgroundLock = (ms: number) => {
  backgroundLockPausedUntil = Date.now() + ms;
};
export const backgroundLockPaused = () => Date.now() < backgroundLockPausedUntil;

/** Work to finish before the app locks when going to the background (e.g. sync upload). */
const beforeBackground = new Set<() => Promise<void>>();
export function onBeforeBackground(fn: () => Promise<void>) {
  beforeBackground.add(fn);
  return () => {
    beforeBackground.delete(fn);
  };
}
export async function runBeforeBackground(timeoutMs = 6000) {
  await Promise.race([Promise.allSettled([...beforeBackground].map((f) => f())), new Promise((r) => setTimeout(r, timeoutMs))]);
}
