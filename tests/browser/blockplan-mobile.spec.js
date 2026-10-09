import { test, expect } from '@playwright/test';
const URL = '/apps/blockplan/';
const NOW = new Date(2026, 9, 9, 10, 20);
const tray = (page, name) => page.locator('.tray-block').filter({ has: page.locator('.b-title', { hasText: new RegExp(`^${name}$`) }) });
const placed = (page, name) => page.locator('.placed').filter({ has: page.locator('.b-title', { hasText: new RegExp(`^${name}$`) }) });

async function phone(browser, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(NOW);
  await page.goto(URL);
  await expect(tray(page, 'Gym')).toBeVisible();
  // A realistically long tray: more blocks than fit on one screen.
  await page.evaluate(() => {
    const key = 'blockplan:v1:guest';
    const record = JSON.parse(localStorage.getItem(key));
    const types = record.state.types;
    for (let index = 0; index < 16; index++) {
      record.state.blocks.push({ id: `extra${index}`, title: `Errand ${index}`, typeId: types[index % types.length].id, minutes: [15, 30, 45, 60][index % 4], scope: 'day', reusable: false, done: false, at: null });
    }
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.reload();
  await expect(tray(page, 'Errand 15')).toHaveCount(1);
  const session = await context.newCDPSession(page);
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  return { context, page, errors, touch };
}
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

test('the timeline stays pinned and a block deep in the tray can be held and dragged onto it', async ({ browser }) => {
  const { context, page, errors, touch } = await phone(browser);
  const block = tray(page, 'Errand 13');
  await block.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await expect(page.locator('#timeline-card')).toHaveClass(/stuck/);
  const card = await page.locator('#timeline-card').boundingBox();
  expect(Math.round(card.y)).toBe(0);
  await expect(page.locator('#stuck-date')).toHaveText('Fri, Oct 9');
  await expect(page.locator('#free-time')).toContainText('free in your planning hours');

  const from = await block.boundingBox();
  expect(from.y).toBeGreaterThan(card.y + card.height);
  const lanes = await page.locator('#lanes').boundingBox();
  const target = [lanes.x + 200, lanes.y + 30];
  await touch('touchStart', [[from.x + 12, from.y + 20]]);
  await expect(block).toHaveClass(/pressing/);
  await page.waitForTimeout(420);
  for (let step = 1; step <= 14; step++) {
    await touch('touchMove', [[from.x + 12 + (target[0] - from.x - 12) * step / 14, from.y + 20 + (target[1] - from.y - 20) * step / 14]]);
  }
  await expect(page.locator('#drop-preview')).toBeVisible();
  await touch('touchEnd', []);
  await expect(placed(page, 'Errand 13')).toHaveCount(1);
  await expect(tray(page, 'Errand 13')).toHaveCount(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
  await context.close();
});

test('pinch and buttons zoom the timeline around the fingers', async ({ browser }) => {
  const { context, page, errors, touch } = await phone(browser);
  const width = () => page.locator('#track').evaluate(node => node.getBoundingClientRect().width);
  const before = await width();
  const box = await page.locator('#timeline').boundingBox();
  const y = box.y + box.height - 40, mid = box.x + box.width / 2;
  await touch('touchStart', [[mid - 30, y], [mid + 30, y]]);
  for (let step = 1; step <= 6; step++) await touch('touchMove', [[mid - 30 - step * 15, y], [mid + 30 + step * 15, y]]);
  await touch('touchEnd', []);
  expect(await width()).toBeGreaterThan(before * 2);
  await expect(page.locator('.ghost')).toHaveCount(0);

  // Zoom out until the whole day fits on the screen.
  for (let count = 0; count < 8 && await page.locator('#zoom-out').isEnabled(); count++) await page.locator('#zoom-out').click();
  await expect(page.locator('#zoom-out')).toBeDisabled();
  const scroller = await page.locator('#timeline').evaluate(node => [node.scrollWidth, node.clientWidth]);
  expect(scroller[0]).toBeLessThanOrEqual(scroller[1] + 1);
  await page.reload();
  await expect(page.locator('#zoom-out'), 'zoom is remembered').toBeDisabled();
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-out')).toBeEnabled();
  expect(errors).toEqual([]);
  await context.close();
});

test('swipe the header between days; swipe a sheet down to close it', async ({ browser }) => {
  const { context, page, errors, touch } = await phone(browser);
  const heading = await page.locator('#heading').boundingBox();
  const y = heading.y + heading.height / 2;
  await touch('touchStart', [[300, y]]);
  for (let step = 1; step <= 5; step++) await touch('touchMove', [[300 - step * 40, y + step]]);
  await touch('touchEnd', []);
  await expect(page.locator('#heading')).toContainText('Saturday, October 10');
  await expect(page.locator('#heading')).toContainText('Tomorrow');

  await page.getByRole('button', { name: 'New block' }).click();
  const head = await page.locator('#block-dialog .sheet-head').boundingBox();
  await page.waitForTimeout(250);
  await touch('touchStart', [[head.x + 120, head.y + 10]]);
  for (let step = 1; step <= 6; step++) await touch('touchMove', [[head.x + 120, head.y + 10 + step * 30]]);
  await touch('touchEnd', []);
  await expect(page.locator('#block-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}×${viewport.height}: controls are thumb-sized and the plan is visible without scrolling`, async ({ browser }) => {
    const { context, page, errors } = await phone(browser, viewport);
    await noOverflow(page);
    const small = await page.evaluate(() => [...document.querySelectorAll('header button, header a, .card-head button, .fab, .seg button')]
      .filter(node => node.offsetParent)
      .map(node => ({ name: node.getAttribute('aria-label') || node.textContent.trim(), ...node.getBoundingClientRect().toJSON() }))
      .filter(box => box.width < 44 || box.height < 40));
    expect(small).toEqual([]);
    // The timeline and the first row of the tray share the first screen.
    const trayRow = await page.locator('.tray-block').first().boundingBox();
    expect(trayRow.y).toBeLessThan(viewport.height);
    const lanes = await page.locator('#lanes').boundingBox();
    expect(lanes.y + lanes.height).toBeLessThan(viewport.height);
    await page.getByRole('button', { name: 'New block' }).click();
    await page.waitForTimeout(350);
    const save = await page.getByRole('button', { name: 'Add to tray' }).boundingBox();
    expect(save.y + save.height).toBeLessThanOrEqual(viewport.height);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('picking up a block keeps the timeline where it was', async ({ browser }) => {
  const { context, page, errors } = await phone(browser);
  const scroll = () => page.locator('#timeline').evaluate(node => node.scrollLeft);
  const before = await scroll();
  expect(before).toBeGreaterThan(0);
  await tray(page, 'Call parents').tap();
  await expect(page.locator('#pickbar')).toBeVisible();
  expect(await scroll()).toBe(before);
  expect(errors).toEqual([]);
  await context.close();
});
