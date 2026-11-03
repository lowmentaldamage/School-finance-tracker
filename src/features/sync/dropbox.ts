/**
 * Dropbox transport for sync. Only one encrypted file (`/keel.keelbak` in the app's own
 * Dropbox folder) is ever read or written; Dropbox never sees unencrypted data.
 * Network calls go through the native layer, which only allows Dropbox's API hosts.
 */
import { call } from '../../api/client';
import { b64ToText, isAndroidApp, native, pauseBackgroundLock, textToB64, toB64 } from '../../lib/native';

export const DROPBOX_APP_KEY: string = (import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined) ?? '';
export const dropboxAvailable = (): boolean => isAndroidApp() && DROPBOX_APP_KEY.length > 0;

const REDIRECT = `db-${DROPBOX_APP_KEY}://auth`;
const FILE = '/keel.keelbak';
const PKCE_KEY = 'keel.dropbox.pkce';

interface Http {
  status: number;
  body: string;
  api_result: string;
}

async function http(url: string, headers: Record<string, string>, bodyB64 = ''): Promise<Http> {
  return native<Http>('httpRequest', { url, method: 'POST', headers: JSON.stringify(headers), body: bodyB64 });
}

function b64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function form(o: Record<string, string>): string {
  return textToB64(new URLSearchParams(o).toString());
}

/** Step 1: open Dropbox sign-in in the browser. */
export async function startSignIn(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: REDIRECT,
    state,
  });
  pauseBackgroundLock(5 * 60_000);
  await native('openUrl', { url: `https://www.dropbox.com/oauth2/authorize?${q.toString()}` });
}

/** Step 2: after returning from the browser, finish sign-in. Returns false if nothing is pending. */
export async function finishSignIn(): Promise<boolean> {
  const { url } = await native<{ url: string }>('takeAuthRedirect');
  if (!url) return false;
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string } | null;
  sessionStorage.removeItem(PKCE_KEY);
  const params = new URL(url.replace(/^db-[^:]+:\/\/auth/, 'https://x/auth')).searchParams;
  if (!saved || params.get('state') !== saved.state) throw new Error('Sign-in was not started from this app. Try again.');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error_description') ?? 'Dropbox sign-in was cancelled.');
  const r = await http(
    'https://api.dropboxapi.com/oauth2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    form({ code, grant_type: 'authorization_code', client_id: DROPBOX_APP_KEY, code_verifier: saved.verifier, redirect_uri: REDIRECT }),
  );
  if (r.status !== 200) throw new Error('Dropbox did not accept the sign-in. Try again.');
  const tok = JSON.parse(b64ToText(r.body)) as { access_token: string; refresh_token: string; expires_in: number };
  cache = { token: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000 };
  let name = '';
  const acc = await http('https://api.dropboxapi.com/2/users/get_current_account', { Authorization: `Bearer ${tok.access_token}` });
  if (acc.status === 200) {
    const a = JSON.parse(b64ToText(acc.body)) as { email?: string; name?: { display_name?: string } };
    name = a.email ?? a.name?.display_name ?? '';
  }
  await call('sync.set_token', { refresh_token: tok.refresh_token, account_name: name });
  return true;
}

let cache: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cache && Date.now() < cache.until) return cache.token;
  const { refresh_token } = await call<{ refresh_token: string | null }>('sync.get_token');
  if (!refresh_token) throw new Error('Not connected to Dropbox.');
  const r = await http(
    'https://api.dropboxapi.com/oauth2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    form({ grant_type: 'refresh_token', refresh_token, client_id: DROPBOX_APP_KEY }),
  );
  if (r.status !== 200) throw new Error('Dropbox access has expired or was revoked. Connect again.');
  const tok = JSON.parse(b64ToText(r.body)) as { access_token: string; expires_in: number };
  cache = { token: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000 };
  return tok.access_token;
}

export function forgetToken() {
  cache = null;
}

export async function remoteRev(): Promise<string | null> {
  const r = await http(
    'https://api.dropboxapi.com/2/files/get_metadata',
    { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    textToB64(JSON.stringify({ path: FILE })),
  );
  if (r.status === 409) return null; // not found
  if (r.status !== 200) throw new Error(`Dropbox error (${r.status}).`);
  return (JSON.parse(b64ToText(r.body)) as { rev: string }).rev;
}

export async function download(): Promise<{ data: string; rev: string }> {
  const r = await http('https://content.dropboxapi.com/2/files/download', {
    Authorization: `Bearer ${await accessToken()}`,
    'Dropbox-API-Arg': JSON.stringify({ path: FILE }),
  });
  if (r.status !== 200) throw new Error(`Dropbox download failed (${r.status}).`);
  return { data: r.body, rev: (JSON.parse(r.api_result) as { rev: string }).rev };
}

/** Upload; `expectRev` makes Dropbox refuse if someone else changed the file meanwhile. */
export async function upload(dataB64: string, expectRev: string | null): Promise<{ rev: string } | 'conflict'> {
  const mode = expectRev ? { '.tag': 'update', update: expectRev } : 'overwrite';
  const r = await http(
    'https://content.dropboxapi.com/2/files/upload',
    {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: FILE, mode, mute: true, strict_conflict: true }),
    },
    dataB64,
  );
  if (r.status === 409) return 'conflict';
  if (r.status !== 200) throw new Error(`Dropbox upload failed (${r.status}).`);
  return { rev: (JSON.parse(b64ToText(r.body)) as { rev: string }).rev };
}
