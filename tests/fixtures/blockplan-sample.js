// A realistic plan for tests. The app itself starts empty; this keeps the
// browser and unit tests exercising a populated timeline and tray.
import { validateState, weekStart, addDays, newId, DAY_MINUTES, DEFAULT_SETTINGS, SCHEMA_VERSION, STARTER_TYPES } from '../../apps/blockplan/model.js';

export function samplePlan(today) {
  const types = STARTER_TYPES.map(type => ({ id: newId(), ...type }));
  const t = Object.fromEntries(types.map(type => [type.name, type.id]));
  const monday = weekStart(today);
  const block = (title, type, minutes, extra = {}) => ({ id: newId(), title, typeId: t[type], minutes, scope: 'day', reusable: false, done: false, at: null, ...extra });
  const blocks = [
    block('Write project brief', 'Deep work', 120, { at: { date: today, start: 9 * 60 } }),
    block('Team standup', 'Meetings', 30, { at: { date: today, start: 11 * 60 + 30 } }),
    block('Lunch walk', 'Health', 45, { at: { date: today, start: 12 * 60 + 30 } }),
    block('Inbox zero', 'Admin', 30, { reusable: true }),
    block('Review pull requests', 'Deep work', 60),
    block('1:1 with Sam', 'Meetings', 30),
    block('Gym', 'Health', 60, { reusable: true }),
    block('Pay bills', 'Admin', 15),
    block('Call parents', 'Personal', 45),
    block('Read a chapter', 'Personal', 30),
    block('Sketch new feature', 'Deep work', 90),
    block('Product sprint', 'Deep work', 2 * DAY_MINUTES, { scope: 'week', at: { date: monday, start: 0 } }),
    block('Errands', 'Admin', DAY_MINUTES, { scope: 'week', at: { date: addDays(monday, 5), start: 0 } }),
    block('Long run', 'Health', DAY_MINUTES, { scope: 'week', at: { date: today, start: 0 } }),
    block('Plan next quarter', 'Deep work', DAY_MINUTES, { scope: 'week' }),
    block('Dinner with friends', 'Personal', DAY_MINUTES, { scope: 'week' }),
    block('Weekend trip', 'Personal', 2 * DAY_MINUTES, { scope: 'week' }),
    block('Expenses', 'Admin', DAY_MINUTES, { scope: 'week' }),
  ];
  return validateState({ schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, types, blocks }, { strict: true });
}

// Playwright: store the sample as this device's guest plan before the page
// loads, unless a test (or a reload) already has a plan there.
export async function useSamplePlan(page, today) {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: 'blockplan:v1:guest', value: JSON.stringify({ state: samplePlan(today), dirty: false }) });
}
