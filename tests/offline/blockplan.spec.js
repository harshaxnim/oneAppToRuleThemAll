import { test, expect } from '@playwright/test';
import { useSamplePlan } from '../fixtures/blockplan-sample.js';
import { dateKey } from '../../apps/blockplan/model.js';
test('Blockplan installs a scoped worker and plans offline at the Pages subpath', async ({ page, context }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await useSamplePlan(page, dateKey(new Date()));
  await page.goto('apps/blockplan/');
  await expect(page.locator('.tray-block').first()).toBeVisible();
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    return { url: link.href, value: await (await fetch(link.href)).json() };
  });
  expect(new URL(manifest.value.start_url, manifest.url).pathname).toBe('/websiteSetup/apps/blockplan/');
  expect(manifest.value.display).toBe('standalone');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/websiteSetup/apps/blockplan/');
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.tray-block').first()).toBeVisible();
  expect(await page.evaluate(async () => {
    try { await fetch('../../uncached-connectivity-check'); return true; } catch { return false; }
  })).toBe(false);
  const block = page.locator('.tray-block').filter({ hasText: 'Pay bills' });
  await block.click();
  await page.getByRole('button', { name: 'Next free time' }).click();
  await expect(page.locator('.placed').filter({ hasText: 'Pay bills' })).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.placed').filter({ hasText: 'Pay bills' }), 'offline changes persist').toHaveCount(1);
  const caches = await page.evaluate(async () => (await Promise.all((await window.caches.keys()).map(async key => (await (await window.caches.open(key)).keys()).map(request => request.url)))).flat());
  expect(caches.some(url => /firestore|identitytoolkit|googleapis/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});
