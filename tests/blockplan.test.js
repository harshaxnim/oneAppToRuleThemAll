import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuickTitle, formatDuration, formatClock, weekStart, weekDays, addDays, assignLanes, starterState, SAMPLE_BLOCKS,
  validateState, placeBlock, unplaceBlock, addBlock, addType, deleteType, nextFreeStart, nextFreeWeekOffset,
  trayBlocks, dayPlaced, weekPlaced, weekContextForDay, dayRange, parseImport, exportData, duplicateBlock,
} from '../apps/blockplan/model.js';
import { samplePlan } from './fixtures/blockplan-sample.js';
const seedState = samplePlan;

test('quick titles carry a duration', () => {
  assert.deepEqual(parseQuickTitle('Write report 90m'), { title: 'Write report', minutes: 90 });
  assert.deepEqual(parseQuickTitle('Gym 1h30'), { title: 'Gym', minutes: 90 });
  assert.deepEqual(parseQuickTitle('Deep  work 1.5h'), { title: 'Deep work', minutes: 90 });
  assert.deepEqual(parseQuickTitle('Trip 2d', { dayLength: 1440 }), { title: 'Trip', minutes: 2880 });
  assert.deepEqual(parseQuickTitle('Read 2 hours'), { title: 'Read', minutes: 120 });
  assert.deepEqual(parseQuickTitle('Plan Q4'), { title: 'Plan Q4', minutes: null });
  assert.deepEqual(parseQuickTitle('90m'), { title: '90m', minutes: null });
});

test('durations and clock read naturally', () => {
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(90), '1h 30m');
  assert.equal(formatDuration(120), '2h');
  assert.equal(formatDuration(960, { dayLength: 960 }), '1 day');
  assert.equal(formatDuration(480, { dayLength: 960 }), 'Half day');
  assert.equal(formatClock(13 * 60 + 5), '1:05 pm');
  assert.equal(formatClock(0, { compact: true }), '12a');
});

test('weeks start on Monday and span DST-safe local dates', () => {
  assert.equal(weekStart('2026-10-09'), '2026-10-05');
  assert.equal(weekStart('2026-10-05'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.deepEqual(weekDays('2026-11-01').slice(0, 2), ['2026-10-26', '2026-10-27']);
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
});

test('overlapping blocks stack into lanes', () => {
  const { lanes, count } = assignLanes([
    { id: 'a', start: 0, end: 60 }, { id: 'b', start: 30, end: 90 }, { id: 'c', start: 60, end: 120 }, { id: 'd', start: 40, end: 50 },
  ]);
  assert.equal(count, 3);
  assert.equal(lanes.get('a'), 0); assert.equal(lanes.get('b'), 1); assert.equal(lanes.get('c'), 0); assert.equal(lanes.get('d'), 2);
});

test('placing, reusing, and unplacing blocks', () => {
  const today = '2026-10-09';
  let state = seedState(today);
  const gym = state.blocks.find(block => block.title === 'Gym');
  assert.equal(gym.reusable, true);
  const placed = placeBlock(state, gym.id, { date: today, start: 17 * 60 + 7 });
  assert.notEqual(placed.id, gym.id, 'reusable blocks place a copy');
  assert.equal(placed.state.blocks.find(block => block.id === placed.id).at.start, 17 * 60);
  assert.ok(trayBlocks(placed.state, 'day').some(block => block.id === gym.id));
  const pay = state.blocks.find(block => block.title === 'Pay bills');
  state = placeBlock(placed.state, pay.id, { date: today, start: 23 * 60 + 55 }).state;
  assert.equal(state.blocks.find(block => block.id === pay.id).at.start, 23 * 60 + 45, 'clamped inside the day');
  state = unplaceBlock(state, pay.id);
  assert.equal(state.blocks.find(block => block.id === pay.id).at, null);
  assert.equal(dayPlaced(state, today).length, 4);
});

test('week blocks are whole days placed on day columns', () => {
  const today = '2026-10-09';
  const state = seedState(today);
  const sprint = weekPlaced(state, today).find(item => item.block.title === 'Product sprint');
  assert.equal(sprint.offset, 0);
  assert.equal(sprint.block.minutes, 2 * 1440);
  assert.equal(formatDuration(sprint.block.minutes, { dayLength: 1440 }), '2 days');
  const trip = state.blocks.find(block => block.title === 'Weekend trip');
  // Dropping anywhere on Saturday places it on Saturday with no time of day.
  const moved = placeBlock(state, trip.id, { date: '2026-10-10', start: 15 * 60 }).state;
  assert.deepEqual(moved.blocks.find(block => block.id === trip.id).at, { date: '2026-10-10', start: 0 });
  assert.deepEqual(weekContextForDay(moved, '2026-10-11').map(item => [item.block.title, item.from, item.to]), [['Weekend trip', '2026-10-10', '2026-10-11']]);
  assert.deepEqual(weekContextForDay(moved, '2026-10-06').map(item => item.block.title), ['Product sprint']);
  assert.deepEqual(weekContextForDay(moved, '2026-10-08'), []);
  // A two-day block dropped on Sunday is pulled back so it ends on Sunday.
  const end = placeBlock(state, trip.id, { date: '2026-10-11', start: 0 }).state;
  assert.equal(end.blocks.find(block => block.id === trip.id).at.date, '2026-10-10');
  assert.deepEqual(nextFreeWeekOffset(state, today, 1440), { date: '2026-10-07', start: 0 });
  const tooShort = state.blocks.find(block => block.title === 'Expenses');
  assert.throws(() => addBlock(state, { title: 'Two hours', typeId: tooShort.typeId, minutes: 120, scope: 'week' }), /whole days/);
});

test('hour-based week blocks from the first version become whole days', () => {
  const state = seedState('2026-10-09');
  const typeId = state.types[0].id;
  const old = { ...state, schemaVersion: 1, blocks: [
    { id: 'a', title: 'Sprint', typeId, minutes: 16 * 60, scope: 'week', at: { date: '2026-10-05', start: 7 * 60 } },
    { id: 'b', title: 'Run', typeId, minutes: 120, scope: 'week', at: null },
    { id: 'c', title: 'Offsite', typeId, minutes: 20 * 60, scope: 'week', at: null },
  ] };
  const upgraded = validateState(old);
  assert.equal(upgraded.schemaVersion, 3);
  assert.deepEqual(upgraded.blocks.map(block => [block.minutes / 1440, block.at]), [[1, { date: '2026-10-05', start: 0 }], [1, null], [2, null]]);
});

test('next free time skips busy spans', () => {
  const state = seedState('2026-10-09');
  assert.equal(nextFreeStart(state, '2026-10-09', 60, 9 * 60), 13 * 60 + 15);
  assert.equal(nextFreeStart(state, '2026-10-09', 30, 9 * 60), 11 * 60);
  assert.equal(nextFreeStart(state, '2026-10-09', 60, 22 * 60 + 30), null);
});

test('day range widens to placed blocks outside the window', () => {
  let state = seedState('2026-10-09');
  state = placeBlock(state, state.blocks.find(block => block.title === 'Read a chapter').id, { date: '2026-10-09', start: 5 * 60 + 30 }).state;
  assert.deepEqual(dayRange(state, '2026-10-09'), { from: 5 * 60, to: 23 * 60 });
});

test('validation drops malformed stored records but rejects bad imports', () => {
  const state = seedState('2026-10-09');
  const broken = { ...state, blocks: [...state.blocks, { id: 'x', title: '', typeId: 'nope', minutes: 7 }] };
  assert.equal(validateState(broken).blocks.length, state.blocks.length);
  assert.throws(() => parseImport(JSON.stringify(broken)), /name|type/);
  assert.throws(() => parseImport('{'), /JSON/);
  assert.equal(parseImport(exportData(state)).blocks.length, state.blocks.length);
  assert.throws(() => validateState({ types: 'no' }), /not a Blockplan plan/);
});

test('types and blocks are created through validated commands', () => {
  let state = seedState('2026-10-09');
  assert.throws(() => addType(state, { name: 'Deep work', color: '#e0684b' }), /already/);
  assert.throws(() => addType(state, { name: 'Study', color: 'red' }), /color/);
  const added = addType(state, { name: 'Study', color: '#2a9195' });
  state = added.state;
  assert.throws(() => addBlock(state, { title: 'Odd', typeId: added.type.id, minutes: 20, scope: 'day' }), /15 minute/);
  const block = addBlock(state, { title: 'Flashcards', typeId: added.type.id, minutes: 30, scope: 'day' });
  const copy = duplicateBlock(block.state, block.block.id);
  assert.equal(copy.state.blocks.filter(item => item.title === 'Flashcards').length, 2);
  const removed = deleteType(copy.state, added.type.id);
  assert.equal(removed.blocks.some(item => item.typeId === added.type.id), false);
});

test('a new plan has starter types and no blocks', () => {
  const state = starterState();
  assert.deepEqual(state.types.map(type => type.name), ['Deep work', 'Meetings', 'Health', 'Admin', 'Personal']);
  assert.deepEqual(state.blocks, []);
  assert.deepEqual(validateState(state), state);
});

test('plans saved before version 3 lose only the untouched example blocks', () => {
  const sample = samplePlan('2026-10-09');
  const deep = sample.types.find(type => type.name === 'Deep work').id;
  const mine = [
    { id: 'mine1', title: 'Write thesis chapter', typeId: deep, minutes: 120, scope: 'day', at: { date: '2026-10-09', start: 600 } },
    { id: 'mine2', title: 'Gym', typeId: deep, minutes: 60, scope: 'day', at: null },
    { id: 'mine3', title: 'Product sprint', typeId: deep, minutes: 1440, scope: 'day', at: null },
  ];
  const old = { ...sample, schemaVersion: 2, blocks: [...sample.blocks, ...mine] };
  const cleaned = validateState(old);
  assert.deepEqual(cleaned.blocks.map(block => block.id), ['mine1', 'mine2', 'mine3'], 'same name with another type or scope is kept');
  assert.equal(cleaned.types.length, 5);
  assert.equal(SAMPLE_BLOCKS.length, 18);
  // Version 3 plans are never filtered, even if names match.
  assert.equal(validateState(sample).blocks.length, sample.blocks.length);
});
