// End-to-end smoke test: real UI (Vite) + real Rust core (keel-devserver) + fresh encrypted database.
// Run: npm run e2e   (requires Chromium + Playwright, see README)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const UI = 'http://localhost:5173/';
const BRIDGE = 'http://127.0.0.1:5174/call';
const dataDir = mkdtempSync(join(tmpdir(), 'keel-e2e-'));
const procs = [];

function start(cmd, args, env = {}) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  p.stderr.on('data', () => {});
  procs.push(p);
  return p;
}

async function waitFor(fn, label, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${label}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main() {
  start('cargo', ['run', '-q', '-p', 'keel-devserver'], { KEEL_DEV_DATA: dataDir });
  start('npx', ['vite', '--port', '5173', '--strictPort']);
  await waitFor(async () => (await fetch(BRIDGE, { method: 'POST', body: '{"cmd":"app.status"}' })).ok, 'dev backend', 600_000);
  await waitFor(async () => (await fetch(UI)).ok, 'vite');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(UI);
  await page.getByText('Welcome to Keel').waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill('Main checking');
  await page.getByLabel('Current balance').fill('1.000,00');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.getByRole('heading', { name: 'Transactions' }).waitFor();

  const dialog = page.getByRole('dialog');
  async function add({ type = 'Expense', amount, category, payee, date }) {
    await page.getByRole('button', { name: 'Add transaction' }).first().click();
    await dialog.waitFor();
    if (type !== 'Expense') await dialog.getByRole('radio', { name: type }).click();
    await dialog.getByLabel(/^Amount/).fill(amount);
    if (date) await dialog.getByLabel('Date').fill(date);
    if (category) await dialog.getByLabel('Category', { exact: true }).selectOption({ label: category });
    if (payee) await dialog.getByLabel(/^Payee|^Payer/).fill(payee);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    try {
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });
    } catch (e) {
      const alerts = await dialog.getByRole('alert').allTextContents();
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `fail-${Date.now()}.png`) });
      throw new Error(`dialog did not close (${type} ${amount}); alerts: ${JSON.stringify(alerts)}`);
    }
  }

  await add({ type: 'Income', amount: '2500', category: 'Salary', payee: 'Employer' });
  await add({ amount: '45,67', category: 'Food', payee: 'Corner Market' });
  await add({ amount: '0.1', category: 'Other', payee: 'Rounding check' });
  await add({ amount: '0.2', category: 'Other', payee: 'Rounding check 2' });

  // Validation: zero amount is rejected in the form.
  await page.getByRole('button', { name: 'Add transaction' }).first().click();
  await dialog.getByLabel(/^Amount/).fill('0');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByText('Enter an amount greater than zero.').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  await page.getByText('4 transactions').waitFor();

  // Balance: 1000 + 2500 - 45.67 - 0.10 - 0.20 = 3454.03 (exact, no float drift)
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByText('€3,454.03').first().waitFor();

  // Search and filter.
  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.getByLabel(/Search payee/).fill('corner');
  await page.getByText('1 transaction').waitFor();
  await page.getByLabel(/Search payee/).fill('');
  await page.getByText('4 transactions').waitFor();

  // Edit then delete.
  await page.getByRole('button', { name: /Corner Market/ }).click();
  await dialog.getByLabel(/^Amount/).fill('50');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('-€50.00').waitFor();
  await page.getByRole('button', { name: /Corner Market/ }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete transaction?' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByText('3 transactions').waitFor();

  // Category with transactions cannot be deleted without reassignment.
  await page.getByRole('link', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'Actions for Other' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByText('2 transactions use this category').waitFor();
  await page.keyboard.press('Escape');

  // Theme persists across reload.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.reload();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  assert((await page.locator('html').getAttribute('data-theme')) === 'dark', 'dark theme persisted');

  assert(errors.length === 0, `no console errors, got ${JSON.stringify(errors)}`);
  await browser.close();
  console.log('e2e smoke: passed');
}

let code = 0;
try {
  await main();
} catch (e) {
  console.error('e2e smoke: FAILED -', e.message);
  code = 1;
} finally {
  for (const p of procs) p.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
