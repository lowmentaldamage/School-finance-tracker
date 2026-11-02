import type { ApiErrorPayload, AppStatus } from './types';

/** Error raised by the core. `field` names the invalid input, when applicable. */
export class ApiError extends Error {
  readonly code: string;
  readonly field: string | null;
  constructor(p: ApiErrorPayload) {
    super(p.message);
    this.name = 'ApiError';
    this.code = p.code;
    this.field = p.field;
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = (): boolean => typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;

const DEV_BRIDGE = 'http://127.0.0.1:5174/call';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const p = e as ApiErrorPayload;
    return new ApiError({ code: String(p.code), field: p.field ?? null, message: String(p.message) });
  }
  return new ApiError({ code: 'unavailable', field: null, message: 'The app backend is not available.' });
}

async function devCall<T>(cmd: string, args: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(DEV_BRIDGE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
    });
  } catch {
    throw new ApiError({
      code: 'unavailable',
      field: null,
      message: 'Development backend not running. Start it with: cargo run -p keel-devserver',
    });
  }
  const body: unknown = await res.json();
  if (!res.ok) throw toApiError(body);
  return body as T;
}

/** Call a core command. In the packaged app this goes through Tauri IPC. */
export async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke<T>('core_call', { cmd, args });
    } catch (e) {
      throw toApiError(e);
    }
  }
  if (import.meta.env.DEV) return devCall<T>(cmd, args);
  throw toApiError(null);
}

export async function appStatus(): Promise<AppStatus> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AppStatus>('app_status');
  }
  if (import.meta.env.DEV) {
    try {
      return await devCall<AppStatus>('app.status', {});
    } catch (e) {
      const err = toApiError(e);
      return { ready: false, error: { code: err.code, field: null, message: err.message } };
    }
  }
  return { ready: false, error: { code: 'unavailable', field: null, message: 'The app backend is not available.' } };
}
