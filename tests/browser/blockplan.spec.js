import { test, expect } from '@playwright/test';
import { useSamplePlan } from '../fixtures/blockplan-sample.js';
const URL = '/apps/blockplan/';
// A fixed Friday morning keeps the seeded plan and scroll position predictable.
const NOW = new Date(2026, 9, 9, 8, 0);

async function open(page, viewport) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(NOW);
  await useSamplePlan(page, '2026-10-09');
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(URL);
  await expect(page.locator('.tray-block').first()).toBeVisible();
  return errors;
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
}
// Screen x for a clock time on the visible day timeline.
async function xFor(page, label, fraction = 0) {
  const tick = page.locator('.tick', { hasText: new RegExp(`^${label}$`) }).first();
  await tick.scrollIntoViewIfNeeded();
  const box = await tick.boundingBox();
  const next = await page.locator('.tick').nth(1).boundingBox();
  const first = await page.locator('.tick').nth(0).boundingBox();
  return box.x + 1 + fraction * (next.x - first.x);
}
async function laneY(page) {
  const box = await page.locator('#lanes').boundingBox();
  return box.y + 30;
}
const placed = (page, name) => page.locator('.placed', { hasText: name });
const tray = (page, name) => page.locator('.tray-block', { hasText: name });

test('phone: create a block with a new type, pick it up, tap the timeline to place it, undo', async ({ page }) => {
  const errors = await open(page, { width: 360, height: 780 });
  await noOverflow(page);
  await page.getByRole('button', { name: 'New block' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Deep reading 1h30');
  await expect(page.locator('#f-length')).toHaveText('1h 30m');
  await page.getByRole('button', { name: '+ New type' }).click();
  await page.getByLabel('New type name').fill('Study');
  await page.getByRole('radio', { name: 'Teal' }).click();
  await page.getByRole('button', { name: 'Add type' }).click();
  await expect(page.getByRole('radio', { name: 'Study' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Add to tray' }).click();
  await expect(page.locator('#block-dialog')).not.toBeVisible();
  const block = tray(page, 'Deep reading');
  await expect(block).toContainText('1h 30m');
  await noOverflow(page);

  await block.click();
  await expect(page.locator('#pickbar')).toBeVisible();
  await expect(page.locator('#pick-text')).toContainText('Deep reading');
  await page.mouse.click(await xFor(page, '7a'), await laneY(page));
  await expect(placed(page, 'Deep reading')).toHaveAttribute('aria-label', /Deep reading, Study, 7:00 am – 8:30 am/);
  await expect(tray(page, 'Deep reading')).toHaveCount(0);
  await expect(page.locator('#summary')).toContainText('Study 1h 30m');
  await noOverflow(page);

  await page.keyboard.press('Control+z');
  await expect(tray(page, 'Deep reading')).toHaveCount(1);
  await expect(placed(page, 'Deep reading')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('desktop: drag from tray, reusable copies, move, resize, keyboard, unplan by dragging back', async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 860 });
  const gym = tray(page, 'Gym');
  const from = await gym.boundingBox();
  await page.mouse.move(from.x + 10, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y - 40, { steps: 4 });
  await expect(page.locator('.ghost')).toBeVisible();
  await page.mouse.move(await xFor(page, '2p'), await laneY(page), { steps: 8 });
  await expect(page.locator('#drop-preview')).toContainText('2:00 pm – 3:00 pm');
  await page.mouse.up();
  await expect(placed(page, 'Gym')).toHaveAttribute('aria-label', /2:00 pm – 3:00 pm/);
  await expect(tray(page, 'Gym'), 'a reusable block stays in the tray').toHaveCount(1);

  // Resize with the right edge handle: one hour longer.
  const block = await placed(page, 'Gym').boundingBox();
  await page.mouse.move(block.x + block.width - 4, block.y + 20);
  await page.mouse.down();
  await page.mouse.move(block.x + block.width * 2 - 4, block.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(placed(page, 'Gym')).toHaveAttribute('aria-label', /2:00 pm – 4:00 pm, 2h/);

  // Keyboard: move and resize by one step.
  await placed(page, 'Gym').focus();
  await page.keyboard.press('ArrowRight');
  await expect(placed(page, 'Gym')).toHaveAttribute('aria-label', /2:15 pm – 4:15 pm/);
  await expect(placed(page, 'Gym')).toBeFocused();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(placed(page, 'Gym')).toHaveAttribute('aria-label', /2:15 pm – 4:00 pm, 1h 45m/);

  // Drag the brief back into the tray.
  const brief = await placed(page, 'Write project brief').boundingBox();
  const trayBox = await page.locator('#tray').boundingBox();
  await page.mouse.move(brief.x + 20, brief.y + 20);
  await page.mouse.down();
  await page.mouse.move(trayBox.x + 200, trayBox.y + 20, { steps: 8 });
  await expect(page.locator('#tray-card')).toHaveClass(/drop-unplan/);
  await page.mouse.up();
  await expect(tray(page, 'Write project brief')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(placed(page, 'Write project brief')).toHaveCount(1);

  // Delete key unplans; changes survive a reload.
  await placed(page, 'Team standup').focus();
  await page.keyboard.press('Delete');
  await expect(tray(page, 'Team standup')).toHaveCount(1);
  await page.reload();
  await expect(placed(page, 'Gym')).toHaveAttribute('aria-label', /2:15 pm – 4:00 pm/);
  await expect(tray(page, 'Team standup')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('touch: press and hold drags onto the timeline; a quick swipe does not', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = await open(page);
  const session = await context.newCDPSession(page);
  const touch = (type, x, y) => session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

  // A quick swipe over a block is a scroll, not a drag.
  let box = await tray(page, 'Call parents').boundingBox();
  await touch('touchStart', box.x + 20, box.y + 20);
  for (let step = 1; step <= 5; step++) await touch('touchMove', box.x + 20, box.y + 20 - step * 30);
  await touch('touchEnd');
  await expect(page.locator('.ghost')).toHaveCount(0);
  await expect(tray(page, 'Call parents')).toHaveCount(1);

  await tray(page, 'Call parents').scrollIntoViewIfNeeded();
  box = await tray(page, 'Call parents').boundingBox();
  const x = await xFor(page, '7a', 1), y = await laneY(page);
  box = await tray(page, 'Call parents').boundingBox();
  await touch('touchStart', box.x + 10, box.y + 20);
  await page.waitForTimeout(450);
  for (let step = 1; step <= 12; step++) await touch('touchMove', box.x + 10 + (x - box.x - 10) * step / 12, box.y + 20 + (y - box.y - 20) * step / 12);
  await expect(page.locator('#drop-preview')).toContainText('8:00 am');
  await touch('touchEnd');
  await expect(placed(page, 'Call parents')).toHaveAttribute('aria-label', /8:00 am – 8:45 am/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
  await context.close();
});

test('week: day columns with day-long blocks and its own tray', async ({ page }) => {
  const errors = await open(page, { width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Week' }).click();
  await expect(page.locator('#heading')).toContainText('Oct 5 – 11');
  await expect(page.locator('.day-label')).toHaveCount(7);
  await expect(page.locator('.tick'), 'no hour ticks in the week').toHaveCount(0);
  await expect(page.locator('#summary')).toContainText('4 days planned');
  await expect(page.locator('#free-time')).toHaveText('3 open days this week');
  await expect(page.locator('#tray-title')).toContainText('To plan this week');
  await expect(tray(page, 'Gym')).toHaveCount(0);

  // Next open day skips Monday–Tuesday (sprint) and lands on Wednesday.
  await tray(page, 'Plan next quarter').click();
  await expect(page.getByRole('button', { name: 'Next open day' })).toBeVisible();
  await page.getByRole('button', { name: 'Next open day' }).click();
  await expect(placed(page, 'Plan next quarter')).toHaveAttribute('aria-label', /Deep work, Wed, 1 day$/);

  // Tapping Sunday with a two-day block keeps it inside the week: Sat – Sun.
  await tray(page, 'Weekend trip').click();
  const sunday = page.locator('.day-label').last();
  await sunday.scrollIntoViewIfNeeded();
  const column = await sunday.boundingBox();
  const lanes = await page.locator('#lanes').boundingBox();
  await page.mouse.click(column.x + column.width / 2, lanes.y + 30);
  await expect(placed(page, 'Weekend trip')).toHaveAttribute('aria-label', /Sat – Sun, 2 days$/);
  await expect(page.locator('#summary')).toContainText('7 days planned');
  await noOverflow(page);

  await page.getByRole('button', { name: 'New block' }).click();
  await expect(page.locator('#block-title')).toHaveText('New week block');
  await page.getByLabel('Name', { exact: true }).fill('Offsite 2d');
  await expect(page.locator('#f-length')).toHaveText('2 days');
  await page.getByRole('button', { name: 'Add to tray' }).click();
  await expect(tray(page, 'Offsite')).toContainText('2 days');
  expect(errors).toEqual([]);
});

test('day view: circles for the day’s week plans open a card with actions', async ({ page }) => {
  const errors = await open(page, { width: 360, height: 780 });
  // Friday has the seeded “Long run”; Monday has the two-day sprint.
  await expect(page.locator('#dots .dot')).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.locator('#heading')).toContainText('Tuesday, October 6');
  const dot = page.getByRole('button', { name: /^Product sprint, Deep work, Monday – Tuesday$/ });
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);

  await dot.click();
  await expect(page.locator('#week-pop')).toBeVisible();
  await expect(page.locator('#pop-title')).toHaveText('Product sprint');
  await expect(page.locator('#pop-meta')).toHaveText('Deep work · Mon – Tue · 2 days');
  await expect(page.locator('#pop-done')).toBeFocused();
  await page.locator('#pop-done').click();
  await expect(page.locator('#pop-done')).toHaveText('Mark not done');
  await expect(page.locator('#dots .dot')).toHaveClass(/done/);
  await expect(page.getByRole('button', { name: /^Done: Product sprint/ })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#week-pop')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Done: Product sprint/ })).toBeFocused();

  await page.getByRole('button', { name: /^Done: Product sprint/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#block-title')).toHaveText('Edit block');
  await expect(page.locator('#f-day')).toHaveValue('2026-10-05');
  await expect(page.locator('#f-start'), 'week blocks have no time of day').toHaveCount(0);
  await page.locator('#block-dialog').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /^Done: Product sprint/ }).click();
  await page.getByRole('button', { name: 'Open week' }).click();
  await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');
  await expect(placed(page, 'Product sprint')).toHaveAttribute('aria-label', /^Done: Product sprint/);
  await page.getByRole('tab', { name: 'Day' }).click();
  await page.locator('h1').click();
  await expect(page.locator('#week-pop')).toBeHidden();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('#week-dots'), 'Wednesday has no week plans').toBeHidden();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('settings: rename and delete a type with undo; planning hours change the axis', async ({ page }) => {
  const errors = await open(page, { width: 360, height: 780 });
  await page.getByRole('button', { name: 'Menu' }).click();
  const name = page.getByLabel('Name of type Personal');
  await name.fill('Family');
  await name.press('Enter');
  await expect(page.getByLabel('Name of type Family')).toHaveValue('Family');
  await expect(page.locator('#type-list li')).toHaveCount(5);
  await page.getByRole('button', { name: 'Delete type Family' }).click();
  await expect(page.locator('#confirm-text')).toContainText('4 blocks');
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#type-list li')).toHaveCount(4);
  await page.locator('#menu-dialog').getByRole('button', { name: 'Close' }).click();
  await expect(tray(page, 'Call parents')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tray(page, 'Call parents')).toHaveCount(1);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByLabel('Day starts').selectOption({ label: '9:00 am' });
  await page.locator('#menu-dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tick').first()).toHaveText('9a');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('first visit: an empty plan with starter types and helpful empty states', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await expect(page.locator('.tray-empty')).toContainText('Add things you want to do');
  await expect(page.locator('.block')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveText('Nothing planned for this day yet.');
  await expect(page.locator('.lanes-empty')).toHaveText('Click a time to add a block there.');
  await page.getByRole('tab', { name: 'Week' }).click();
  await expect(page.locator('.tray-empty')).toContainText('Add things for this week');
  await page.getByRole('tab', { name: 'Day' }).click();
  await page.locator('.tray-empty').getByRole('button', { name: 'New block' }).click();
  await expect(page.getByRole('radio')).toHaveCount(5);
  await page.getByLabel('Name', { exact: true }).fill('First thing 30m');
  await page.getByRole('button', { name: 'Add to tray' }).click();
  await expect(tray(page, 'First thing')).toContainText('30m');
  await expect(page.locator('.tray-empty')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a plan saved by an earlier version opens without the example blocks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(NOW);
  await useSamplePlan(page, '2026-10-09');
  // Mark the stored plan as older and add one block of the person's own.
  await page.addInitScript(() => {
    const key = 'blockplan:v1:guest';
    const record = JSON.parse(localStorage.getItem(key));
    if (record.state.schemaVersion !== 3) return;
    record.state.schemaVersion = 2;
    record.state.blocks.push({ id: 'mine', title: 'Dentist', typeId: record.state.types[2].id, minutes: 60, scope: 'day', at: { date: '2026-10-09', start: 900 } });
    localStorage.setItem(key, JSON.stringify(record));
  });
  await page.goto(URL);
  await expect(page.locator('.placed')).toHaveCount(1);
  await expect(placed(page, 'Dentist')).toHaveCount(1);
  await expect(page.locator('.tray-block')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Week' }).click();
  await expect(page.locator('.block')).toHaveCount(0);
  expect(errors).toEqual([]);
});
