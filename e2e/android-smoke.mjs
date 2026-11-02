// Android smoke test: drives the real app inside the Android WebView (debug build) over the
// Chrome DevTools Protocol. Requires: adb on PATH, emulator running, debug APK installed.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PKG = 'com.keel.finance';
const OUT = process.env.SHOTS_DIR ?? 'android-shots';
mkdirSync(OUT, { recursive: true });

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  sh(`adb shell am start -n ${PKG}/.MainActivity`);
  let socket = '';
  for (let i = 0; i < 60 && !socket; i++) {
    await sleep(1000);
    const pid = sh(`adb shell pidof ${PKG} || true`);
    const unix = sh('adb shell cat /proc/net/unix');
    const m = unix.match(new RegExp(`@(webview_devtools_remote_${pid})`));
    if (pid && m) socket = m[1];
  }
  if (!socket) throw new Error('WebView devtools socket not found');
  sh(`adb forward tcp:9222 localabstract:${socket}`);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  for (let i = 0; i < 30 && !page; i++) {
    await sleep(500);
    page = ctx.pages()[0];
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.getByText('Welcome to Keel').waitFor({ timeout: 60_000 });
  sh(`adb exec-out screencap -p > ${OUT}/01-onboarding.png`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill('Main checking');
  await page.getByLabel('Current balance').fill('1000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  sh(`adb exec-out screencap -p > ${OUT}/02-overview-empty.png`);

  await page.getByRole('button', { name: 'Add transaction' }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Amount/).fill('12,34');
  await dialog.getByLabel('Category', { exact: true }).selectOption({ label: 'Food' });
  await dialog.getByLabel(/^Payee/).fill('Bakery');
  sh(`adb exec-out screencap -p > ${OUT}/02-add.png`);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Transactions' }).first().waitFor();
  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.getByText('Bakery').waitFor();
  sh(`adb exec-out screencap -p > ${OUT}/03-transactions.png`);

  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByText('€987.66').first().waitFor();
  sh(`adb exec-out screencap -p > ${OUT}/04-overview.png`);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByText('Android Keystore').first().waitFor();
  sh(`adb exec-out screencap -p > ${OUT}/05-settings.png`);

  // App lock with PIN; lock by sending the app to the background, then unlock.
  await page.getByRole('button', { name: 'Set up app lock' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('New PIN').fill('24681357');
  await dlg.getByLabel('Confirm PIN').fill('24681357');
  await dlg.getByRole('button', { name: 'Turn on app lock' }).click();
  await dlg.getByTestId('recovery-key').waitFor();
  await dlg.getByLabel('I have saved my recovery key').check();
  await dlg.getByRole('button', { name: 'Done' }).click();
  sh('adb shell input keyevent KEYCODE_HOME');
  await sleep(2000);
  sh(`adb shell am start -n ${PKG}/.MainActivity`);
  await page.getByText('Keel is locked').waitFor({ timeout: 20_000 });
  sh(`adb exec-out screencap -p > ${OUT}/06-locked.png`);
  for (const d of '24681357') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByText('Android Keystore').first().waitFor();

  // Back button closes a dialog instead of leaving the page.
  await page.getByRole('button', { name: 'Create backup' }).click();
  await dlg.waitFor();
  sh('adb shell input keyevent KEYCODE_BACK');
  await dlg.waitFor({ state: 'detached', timeout: 10_000 });
  await page.getByRole('heading', { name: 'Settings' }).waitFor();

  // Data survives an app restart (encrypted DB re-opened with the Keystore-wrapped key).
  await browser.close();
  sh(`adb shell am force-stop ${PKG}`);
  sh(`adb shell am start -n ${PKG}/.MainActivity`);
  await sleep(4000);
  const pid = sh(`adb shell pidof ${PKG}`);
  sh(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
  const b2 = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p2 = b2.contexts()[0].pages()[0];
  await p2.getByText('Keel is locked').waitFor({ timeout: 30_000 });
  for (const d of '24681357') await p2.getByRole('button', { name: d, exact: true }).click();
  await p2.getByText('Bakery').first().waitFor({ timeout: 30_000 });
  await b2.close();

  if (errors.length) throw new Error(`page errors: ${JSON.stringify(errors)}`);
  console.log('android smoke: passed');
}

main().catch((e) => {
  try {
    sh(`adb exec-out screencap -p > ${OUT}/failure.png`);
  } catch {}
  console.error('android smoke: FAILED -', e.message);
  process.exit(1);
});
