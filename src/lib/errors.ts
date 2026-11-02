import { ApiError } from '../api/client';

/** Map a core error to `{ field, message }` for forms. */
export function fieldError(e: unknown): { field: string | null; message: string } {
  if (e instanceof ApiError) return { field: e.field, message: e.message };
  return { field: null, message: e instanceof Error ? e.message : String(e) };
}

/** Make a core message presentable: "invalid value for `name`: required" -> "Required". */
export function humanize(message: string): string {
  const m = message.replace(/^invalid value for `[^`]+`: /, '').replace(/^conflict: /, '');
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith('.') ? '' : '.');
}
