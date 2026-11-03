// Android smoke test: drives the real app inside the Android WebView (debug build) through the
// raw Chrome DevTools Protocol (Playwright cannot attach to Android WebViews).
// Requires: adb on PATH, an emulator running, the debug APK installed.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PKG = 'com.keel.finance';
const OUT = process.env.SHOTS_DIR ?? 'android-shots';
mkdirSync(OUT, { recursive: true });

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => sh(`adb exec-out screencap -p > ${OUT}/${name}.png`);

// In-page helpers, installed on every evaluation.
const HELPERS = `
window.__k = window.__k || {
  visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; },
  hasText(t) { return document.body.innerText.includes(t); },
  find(name) {
    const els = [...document.querySelectorAll('button, a, [role=radio], [role=menuitem], label')];
    const m = els.filter((e) => __k.visible(e) && ((e.getAttribute('aria-label') || '').trim() === name || e.innerText.trim() === name));
    return m[m.length - 1] || null;
  },
  click(name) { const e = __k.find(name); if (!e) return false; e.click(); return true; },
  control(label) {
    const labels = [...document.querySelectorAll('label')].filter((l) => __k.visible(l) && l.innerText.trim().startsWith(label));
    const l = labels[labels.length - 1];
    if (!l) return null;
    return l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input,select,textarea');
  },
  fill(label, value) {
    const c = __k.control(label);
    if (!c) return false;
    const proto = c instanceof HTMLSelectElement ? HTMLSelectElement.prototype : c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    if (c instanceof HTMLSelectElement) {
      const o = [...c.options].find((o) => o.text.trim() === value || o.value === value);
      if (!o) return false;
      value = o.value;
    }
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(c, value);
    c.dispatchEvent(new Event('input', { bubbles: true }));
    c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  check(label) { const c = __k.control(label); if (!c) return false; if (!c.checked) c.click(); return true; },
};
`;

class Cdp {
  static async connect() {
    let socket = '';
    for (let i = 0; i < 60 && !socket; i++) {
      await sleep(1000);
      const pid = sh(`adb shell pidof ${PKG} || true`);
      if (pid && sh('adb shell cat /proc/net/unix').includes(`webview_devtools_remote_${pid}`)) socket = `webview_devtools_remote_${pid}`;
    }
    if (!socket) throw new Error('WebView devtools socket not found');
    sh('adb forward --remove-all');
    sh(`adb forward tcp:9222 localabstract:${socket}`);
    let target;
    for (let i = 0; i < 30 && !target; i++) {
      await sleep(500);
      try {
        const list = await (await fetch('http://127.0.0.1:9222/json')).json();
        target = list.find((t) => t.type === 'page');
      } catch {
        /* not ready */
      }
    }
    if (!target) throw new Error('no WebView page');
    const c = new Cdp();
    c.ws = new WebSocket(target.webSocketDebuggerUrl);
    c.id = 0;
    c.pending = new Map();
    c.errors = [];
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        c.pending.get(m.id)(m);
        c.pending.delete(m.id);
      } else if (m.method === 'Runtime.exceptionThrown') {
        c.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      }
    };
    await new Promise((res, rej) => {
      c.ws.onopen = res;
      c.ws.onerror = rej;
    });
    await c.send('Runtime.enable');
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res) => this.pending.set(id, res));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: `${HELPERS};(${expr})`, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
    return r.result?.result?.value;
  }
  async waitFor(expr, what, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await this.eval(expr)) return;
      } catch {
        /* page reloading */
      }
      await sleep(300);
    }
    throw new Error(`timeout waiting for ${what}`);
  }
  text(t, ms) {
    return this.waitFor(`__k.hasText(${JSON.stringify(t)})`, `text "${t}"`, ms);
  }
  async click(name) {
    await this.waitFor(`__k.click(${JSON.stringify(name)})`, `button "${name}"`);
  }
  async fill(label, value) {
    await this.waitFor(`__k.fill(${JSON.stringify(label)}, ${JSON.stringify(value)})`, `field "${label}"`);
  }
  async check(label) {
    await this.waitFor(`__k.check(${JSON.stringify(label)})`, `checkbox "${label}"`);
  }
  close() {
    this.ws.close();
  }
}

let current = null;

async function main() {
  sh('adb logcat -c');
  sh(`adb shell am start -n ${PKG}/.MainActivity`);
  let p = await Cdp.connect();
  current = p;

  await p.text('Welcome to Keel', 60_000);
  shot('01-onboarding');
  await p.click('Continue');
  await p.fill('Name', 'Main checking');
  await p.fill('Current balance', '1000');
  await p.click('Continue');
  await p.text('Lock Keel');
  await p.click('Not now');
  await p.text('Overview');
  shot('02-overview-empty');

  await p.click('Add transaction');
  await p.fill('Amount', '12,34');
  await p.fill('Category', 'Food');
  await p.fill('Payee', 'Bakery');
  shot('03-add');
  await p.click('Add');
  await p.waitFor(`!document.querySelector('[role=dialog]')`, 'dialog closed');
  await p.text('€987.66');
  shot('04-overview');

  await p.click('More');
  await p.click('Settings');
  await p.text('Android Keystore');
  shot('05-settings');

  // App lock with PIN, then lock by leaving the app.
  await p.click('Set up app lock');
  await p.fill('New PIN', '24681357');
  await p.fill('Confirm PIN', '24681357');
  await p.click('Turn on app lock');
  await p.waitFor(`!!document.querySelector('[data-testid=recovery-key]')`, 'recovery key');
  await p.check('I have saved my recovery key');
  await p.click('Done');
  sh('adb shell input keyevent KEYCODE_HOME');
  await sleep(2500);
  sh(`adb shell am start -n ${PKG}/.MainActivity`);
  await p.text('Keel is locked', 20_000);
  shot('06-locked');
  for (const d of '24681357') await p.click(d);
  await p.text('Android Keystore');

  // Back button closes a dialog instead of leaving the screen.
  await p.click('Create backup');
  await p.waitFor(`!!document.querySelector('[role=dialog]')`, 'dialog open');
  sh('adb shell input keyevent KEYCODE_BACK');
  await p.waitFor(`!document.querySelector('[role=dialog]')`, 'dialog closed by back button', 10_000);
  await p.text('Settings');
  const errors = [...p.errors];
  p.close();

  // Data survives a restart (encrypted DB re-opened with the Keystore-wrapped key).
  sh(`adb shell am force-stop ${PKG}`);
  sh(`adb shell am start -n ${PKG}/.MainActivity`);
  p = await Cdp.connect();
  current = p;
  await p.text('Keel is locked', 30_000);
  for (const d of '24681357') await p.click(d);
  await p.click('Transactions');
  await p.text('Bakery');
  shot('07-after-restart');
  p.close();

  if (errors.length) throw new Error(`page errors: ${JSON.stringify(errors)}`);
  console.log('android smoke: passed');
}

main().catch(async (e) => {
  try {
    shot('failure');
  } catch {}
  console.error('android smoke: FAILED -', e.message);
  // Diagnostics: what the app shows, script errors, and the Android log.
  try {
    if (current) {
      console.error('--- screen text ---\n' + (await current.eval('document.body.innerText.slice(0, 1500)')));
      console.error('--- location --- ' + (await current.eval('location.href')));
      console.error('--- page errors --- ' + JSON.stringify(current.errors));
    }
  } catch (err) {
    console.error('could not read the page: ' + err.message);
  }
  try {
    console.error('--- logcat ---\n' + sh('adb logcat -d -v brief | grep -iE "keel|tauri|rust|AndroidRuntime|chromium|console" | tail -120'));
  } catch {}
  process.exit(1);
});
