// Pure planning model: no DOM, no storage. Times are minutes since midnight;
// dates are local YYYY-MM-DD keys so a plan never shifts with time zones.
export const SCHEMA_VERSION = 3;
export const DAY_MINUTES = 1440;
// Day blocks move in 15 minute steps; week blocks are whole days.
export const SNAP = { day: 15, week: 1440 };
export const LIMITS = { title: 80, typeName: 32, types: 24, blocks: 4000 };
export const PALETTE = [
  { color: '#e0684b', name: 'Coral' },
  { color: '#d9962b', name: 'Amber' },
  { color: '#7f9a35', name: 'Olive' },
  { color: '#3f9b6b', name: 'Green' },
  { color: '#2a9195', name: 'Teal' },
  { color: '#3b84c9', name: 'Sky' },
  { color: '#5b65cc', name: 'Indigo' },
  { color: '#8e5bc9', name: 'Violet' },
  { color: '#cf5590', name: 'Pink' },
  { color: '#6b7785', name: 'Slate' },
];
const COLORS = new Set(PALETTE.map(item => item.color));
export const DEFAULT_SETTINGS = { dayStart: 7 * 60, dayEnd: 23 * 60 };

export function newId() {
  return (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 16);
}

// ---------- Dates ----------
const pad = value => String(value).padStart(2, '0');
export function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function parseDate(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dateKey(date) === key ? date : null;
}
export function addDays(key, days) {
  const date = parseDate(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
// Weeks start on Monday.
export function weekStart(key) {
  const date = parseDate(key);
  return addDays(key, -((date.getDay() + 6) % 7));
}
export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

// ---------- Durations and clock ----------
export function windowLength(settings) { return settings.dayEnd - settings.dayStart; }
export function formatDuration(minutes, { dayLength } = {}) {
  if (dayLength && minutes >= dayLength && minutes % dayLength === 0) {
    const days = minutes / dayLength;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (dayLength && minutes * 2 === dayLength) return 'Half day';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
export function formatClock(minutes, { compact = false } = {}) {
  const value = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(value / 60), minute = value % 60;
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 || 12;
  if (compact) return minute ? `${twelve}:${pad(minute)}` : `${twelve}${suffix[0]}`;
  return `${twelve}:${pad(minute)} ${suffix}`;
}
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text ?? '');
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
export function clockInput(minutes) { return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`; }

// "Write report 90m", "Gym 1h30", "Trip 2d" → title and duration.
export function parseQuickTitle(text, { dayLength = 16 * 60 } = {}) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match = /^(.*?)\s+(?:(\d+(?:\.\d+)?)\s*(d|days?)|(\d+(?:\.\d+)?)\s*(h|hrs?|hours?)\s*(?:(\d{1,2})\s*(m|mins?|minutes?)?)?|(\d+)\s*(m|mins?|minutes?))$/i.exec(raw);
  if (!match || !match[1]) return { title: raw, minutes: null };
  let minutes;
  if (match[2]) minutes = Number(match[2]) * dayLength;
  else if (match[4]) minutes = Number(match[4]) * 60 + Number(match[6] ?? 0);
  else minutes = Number(match[8]);
  minutes = Math.round(minutes);
  if (!(minutes > 0)) return { title: raw, minutes: null };
  return { title: match[1].trim(), minutes };
}
export function snap(value, step) { return Math.round(value / step) * step; }
export function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

// ---------- Validation ----------
function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value); }
export function validateType(type) {
  if (!type || typeof type !== 'object' || !validId(type.id)) throw new Error('A type needs an ID.');
  const name = cleanText(type.name, LIMITS.typeName);
  if (!name) throw new Error('Give the type a name.');
  if (!COLORS.has(type.color)) throw new Error('Choose one of the type colors.');
  return { id: type.id, name, color: type.color };
}
export function validateBlock(block, typeIds) {
  if (!block || typeof block !== 'object' || !validId(block.id)) throw new Error('A block needs an ID.');
  const title = cleanText(block.title, LIMITS.title);
  if (!title) throw new Error('Give the block a name.');
  if (!typeIds.has(block.typeId)) throw new Error('Choose a type for the block.');
  const scope = block.scope === 'week' ? 'week' : 'day';
  const minutes = Number(block.minutes);
  const max = scope === 'week' ? 7 * DAY_MINUTES : DAY_MINUTES;
  if (!Number.isInteger(minutes) || minutes < SNAP[scope] || minutes > max || minutes % SNAP[scope]) {
    throw new Error(scope === 'week' ? 'Week blocks last whole days, up to a week.' : 'Day blocks last 15 minute steps, up to a day.');
  }
  let at = null;
  if (block.at) {
    const start = Number(block.at.start);
    if (!parseDate(block.at.date) || !Number.isInteger(start) || start < 0 || start >= DAY_MINUTES) throw new Error('The block has an invalid time.');
    // Week blocks belong to a day, not a time of day.
    at = { date: block.at.date, start: scope === 'week' ? 0 : start };
  }
  return { id: block.id, title, typeId: block.typeId, minutes, scope, reusable: block.reusable === true && !at, done: block.done === true && Boolean(at), at };
}
export function validateSettings(settings) {
  const dayStart = Number(settings?.dayStart), dayEnd = Number(settings?.dayEnd);
  if (!Number.isInteger(dayStart) || !Number.isInteger(dayEnd) || dayStart % 60 || dayEnd % 60 || dayStart < 0 || dayEnd > DAY_MINUTES || dayEnd - dayStart < 4 * 60) {
    return { ...DEFAULT_SETTINGS };
  }
  return { dayStart, dayEnd };
}
// Strict for imports; tolerant (drops bad records) for stored data so one
// malformed block can never lock someone out of their plan.
export function validateState(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.types) || !Array.isArray(raw.blocks)) throw new Error('This is not a Blockplan plan.');
  if (raw.types.length > LIMITS.types) throw new Error(`A plan can have up to ${LIMITS.types} types.`);
  if (raw.blocks.length > LIMITS.blocks) throw new Error(`A plan can have up to ${LIMITS.blocks} blocks.`);
  const keep = (list, check) => list.flatMap(item => {
    try { return [check(item)]; } catch (error) { if (strict) throw error; return []; }
  });
  const types = keep(raw.types, validateType).filter((type, index, all) => all.findIndex(other => other.id === type.id) === index);
  const typeIds = new Set(types.map(type => type.id));
  const settings = validateSettings(raw.settings);
  const blocks = keep(raw.blocks, block => validateBlock(upgradeBlock(block, settings), typeIds)).filter((block, index, all) => all.findIndex(other => other.id === block.id) === index);
  const state = { schemaVersion: SCHEMA_VERSION, settings, types, blocks };
  return Number(raw.schemaVersion) < 3 ? withoutSamples(state) : state;
}
// Version 1 sized week blocks in planning hours. They become whole days,
// rounding up, so nothing planned shrinks to zero.
function upgradeBlock(block, settings) {
  if (block?.scope !== 'week' || !Number.isInteger(block.minutes) || block.minutes % DAY_MINUTES === 0) return block;
  const days = clamp(Math.ceil(block.minutes / windowLength(settings)), 1, 7);
  return { ...block, minutes: days * DAY_MINUTES, at: block.at ? { ...block.at, start: 0 } : block.at };
}

// ---------- Queries ----------
export function typeMap(state) { return new Map(state.types.map(type => [type.id, type])); }
export function trayBlocks(state, scope) {
  return state.blocks.filter(block => block.scope === scope && !block.at).sort((a, b) => scatterKey(a.id) - scatterKey(b.id));
}
// A stable shuffle: the tray reads as a loose pile, not sorted by type, and
// it doesn't reshuffle on every change.
export function scatterKey(id) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function dayPlaced(state, date) {
  return state.blocks.filter(block => block.scope === 'day' && block.at?.date === date).sort((a, b) => a.at.start - b.at.start);
}
// The week axis is seven day columns. Offsets are minutes from Monday, always
// on a day boundary.
export function weekOffset(state, date, start, week) {
  const index = week.indexOf(date);
  return index < 0 ? null : index * DAY_MINUTES;
}
export function fromWeekOffset(state, offset, week) {
  return { date: week[clamp(Math.floor(offset / DAY_MINUTES), 0, 6)], start: 0 };
}
export function blockDays(block) { return Math.max(1, Math.round(block.minutes / DAY_MINUTES)); }
export function weekPlaced(state, anyDate) {
  const week = weekDays(anyDate);
  return state.blocks.filter(block => block.scope === 'week' && block.at && week.includes(block.at.date))
    .map(block => ({ block, offset: weekOffset(state, block.at.date, block.at.start, week) }))
    .sort((a, b) => a.offset - b.offset);
}
// Week blocks that include a given day, with the days they span.
export function weekContextForDay(state, date) {
  const index = weekDays(date).indexOf(date);
  return weekPlaced(state, date)
    .filter(({ block, offset }) => offset <= index * DAY_MINUTES && offset + block.minutes > index * DAY_MINUTES)
    .map(({ block }) => ({ block, from: block.at.date, to: addDays(block.at.date, blockDays(block) - 1) }));
}
// Greedy interval colouring: overlapping blocks stack into lanes.
export function assignLanes(items) {
  const lanes = [], result = new Map();
  for (const item of [...items].sort((a, b) => a.start - b.start || b.end - a.end)) {
    let lane = lanes.findIndex(end => end <= item.start);
    if (lane < 0) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = item.end;
    result.set(item.id, lane);
  }
  return { lanes: result, count: Math.max(1, lanes.length) };
}
// Visible day range: the planning window, widened to show anything placed
// outside it (for example after the window was narrowed).
export function dayRange(state, date) {
  let from = state.settings.dayStart, to = state.settings.dayEnd;
  for (const block of dayPlaced(state, date)) {
    from = Math.min(from, block.at.start);
    to = Math.max(to, block.at.start + block.minutes);
  }
  return { from: Math.floor(from / 60) * 60, to: Math.min(DAY_MINUTES, Math.ceil(to / 60) * 60) };
}
export function totalsByType(blocks) {
  const totals = new Map();
  for (const block of blocks) totals.set(block.typeId, (totals.get(block.typeId) ?? 0) + block.minutes);
  return totals;
}
// Earliest gap in the planning window that fits, starting at `from`.
export function nextFreeStart(state, date, minutes, from = state.settings.dayStart) {
  const start = Math.max(state.settings.dayStart, snap(Math.ceil(from / SNAP.day) * SNAP.day, SNAP.day));
  const busy = dayPlaced(state, date).map(block => [block.at.start, block.at.start + block.minutes]);
  for (let candidate = start; candidate + minutes <= state.settings.dayEnd; candidate += SNAP.day) {
    if (busy.every(([a, b]) => candidate + minutes <= a || candidate >= b)) return candidate;
  }
  return null;
}
export function nextFreeWeekOffset(state, date, minutes) {
  const week = weekDays(date), total = 7 * DAY_MINUTES;
  const busy = weekPlaced(state, date).map(({ block, offset }) => [offset, offset + block.minutes]);
  for (let candidate = 0; candidate + minutes <= total; candidate += SNAP.week) {
    if (busy.every(([a, b]) => candidate + minutes <= a || candidate >= b)) return fromWeekOffset(state, candidate, week);
  }
  return null;
}

// ---------- Commands (return a new state) ----------
function withBlocks(state, blocks) { return { ...state, blocks }; }
export function addType(state, { name, color }) {
  if (state.types.length >= LIMITS.types) throw new Error(`You can have up to ${LIMITS.types} types.`);
  const type = validateType({ id: newId(), name, color });
  if (state.types.some(other => other.name.toLowerCase() === type.name.toLowerCase())) throw new Error(`There is already a type called ${type.name}.`);
  return { state: { ...state, types: [...state.types, type] }, type };
}
export function updateType(state, id, changes) {
  const current = state.types.find(type => type.id === id);
  if (!current) throw new Error('That type no longer exists.');
  const type = validateType({ ...current, ...changes, id });
  if (state.types.some(other => other.id !== id && other.name.toLowerCase() === type.name.toLowerCase())) throw new Error(`There is already a type called ${type.name}.`);
  return { ...state, types: state.types.map(other => other.id === id ? type : other) };
}
export function deleteType(state, id) {
  return { ...state, types: state.types.filter(type => type.id !== id), blocks: state.blocks.filter(block => block.typeId !== id) };
}
export function addBlock(state, fields) {
  if (state.blocks.length >= LIMITS.blocks) throw new Error('This plan is full. Delete old blocks to add more.');
  const block = validateBlock({ ...fields, id: newId(), at: null, done: false }, new Set(state.types.map(type => type.id)));
  return { state: withBlocks(state, [...state.blocks, block]), block };
}
export function updateBlock(state, id, changes) {
  const current = state.blocks.find(block => block.id === id);
  if (!current) throw new Error('That block no longer exists.');
  const block = validateBlock({ ...current, ...changes, id }, new Set(state.types.map(type => type.id)));
  return withBlocks(state, state.blocks.map(other => other.id === id ? block : other));
}
export function deleteBlock(state, id) { return withBlocks(state, state.blocks.filter(block => block.id !== id)); }
export function duplicateBlock(state, id) {
  const source = state.blocks.find(block => block.id === id);
  if (!source) throw new Error('That block no longer exists.');
  return addBlock(state, { ...source, reusable: false });
}
// Placing a reusable block puts a copy on the timeline and keeps the original
// in the tray. Starts are clamped so a block never hangs off the plan.
export function placeBlock(state, id, at) {
  const block = state.blocks.find(item => item.id === id);
  if (!block) throw new Error('That block no longer exists.');
  let placed;
  if (block.scope === 'day') {
    const start = clamp(snap(at.start, SNAP.day), 0, DAY_MINUTES - Math.min(block.minutes, DAY_MINUTES));
    placed = { date: at.date, start };
  } else {
    const week = weekDays(at.date);
    const total = 7 * DAY_MINUTES;
    const offset = clamp(snap(weekOffset(state, at.date, at.start, week), SNAP.week), 0, Math.max(0, total - block.minutes));
    placed = fromWeekOffset(state, offset, week);
  }
  if (block.reusable) {
    const copy = validateBlock({ ...block, id: newId(), reusable: false, done: false, at: placed }, new Set(state.types.map(type => type.id)));
    return { state: withBlocks(state, [...state.blocks, copy]), id: copy.id };
  }
  return { state: updateBlock(state, id, { at: placed }), id };
}
export function unplaceBlock(state, id) { return updateBlock(state, id, { at: null, done: false }); }

// ---------- First run ----------
// A new plan starts with a few general types and no blocks.
export const STARTER_TYPES = [
  { name: 'Deep work', color: '#e0684b' },
  { name: 'Meetings', color: '#3b84c9' },
  { name: 'Health', color: '#3f9b6b' },
  { name: 'Admin', color: '#d9962b' },
  { name: 'Personal', color: '#8e5bc9' },
];
export function starterState() {
  return { schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, types: STARTER_TYPES.map(type => ({ id: newId(), ...type })), blocks: [] };
}
// Earlier versions filled new plans with example blocks. Plans saved before
// version 3 drop those (matched by name, scope, and type name); anything the
// person created stays.
export const SAMPLE_BLOCKS = [
  ['Write project brief', 'day', 'Deep work'], ['Team standup', 'day', 'Meetings'], ['Lunch walk', 'day', 'Health'],
  ['Inbox zero', 'day', 'Admin'], ['Review pull requests', 'day', 'Deep work'], ['1:1 with Sam', 'day', 'Meetings'],
  ['Gym', 'day', 'Health'], ['Pay bills', 'day', 'Admin'], ['Call parents', 'day', 'Personal'], ['Read a chapter', 'day', 'Personal'],
  ['Sketch new feature', 'day', 'Deep work'], ['Product sprint', 'week', 'Deep work'], ['Errands', 'week', 'Admin'],
  ['Long run', 'week', 'Health'], ['Plan next quarter', 'week', 'Deep work'], ['Dinner with friends', 'week', 'Personal'],
  ['Weekend trip', 'week', 'Personal'], ['Expenses', 'week', 'Admin'],
];
const SAMPLE_KEYS = new Set(SAMPLE_BLOCKS.map(entry => entry.join('\u0000')));
function withoutSamples(state) {
  const names = new Map(state.types.map(type => [type.id, type.name]));
  return { ...state, blocks: state.blocks.filter(block => !SAMPLE_KEYS.has([block.title, block.scope, names.get(block.typeId)].join('\u0000'))) };
}

export function exportData(state) {
  return JSON.stringify({ app: 'blockplan', exportedAt: new Date().toISOString(), ...state }, null, 2);
}
export function parseImport(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  return validateState(raw, { strict: true });
}
