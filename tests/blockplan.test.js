import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuickTitle, formatDuration, formatClock, weekStart, weekDays, addDays, assignLanes, seedState,
  validateState, placeBlock, unplaceBlock, addBlock, addType, deleteType, nextFreeStart, nextFreeWeekOffset,
  trayBlocks, dayPlaced, weekPlaced, weekContextForDay, dayRange, parseImport, exportData, duplicateBlock,
} from '../apps/blockplan/model.js';

test('quick titles carry a duration', () => {
  assert.deepEqual(parseQuickTitle('Write report 90m'), { title: 'Write report', minutes: 90 });
  assert.deepEqual(parseQuickTitle('Gym 1h30'), { title: 'Gym', minutes: 90 });
  assert.deepEqual(parseQuickTitle('Deep  work 1.5h'), { title: 'Deep work', minutes: 90 });
  assert.deepEqual(parseQuickTitle('Trip 2d', { dayLength: 960 }), { title: 'Trip', minutes: 1920 });
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

test('week blocks run across consecutive planning windows', () => {
  const today = '2026-10-09';
  const state = seedState(today);
  const sprint = weekPlaced(state, today).find(item => item.block.title === 'Product sprint');
  assert.equal(sprint.offset, 0);
  const plan = state.blocks.find(block => block.title === 'Plan next quarter');
  const moved = placeBlock(state, plan.id, { date: '2026-10-06', start: 15 * 60 }).state;
  const tuesday = weekContextForDay(moved, '2026-10-06');
  assert.deepEqual(tuesday.map(item => [item.block.title, item.start, item.end]), [['Plan next quarter', 15 * 60, 23 * 60]]);
  const wednesday = weekContextForDay(moved, '2026-10-07');
  assert.equal(wednesday.length, 0, 'an 8 hour block from 3 pm fills the rest of Tuesday only');
  const end = placeBlock(state, plan.id, { date: '2026-10-11', start: 22 * 60 }).state;
  const last = weekPlaced(end, today).find(item => item.block.id === plan.id);
  assert.equal(last.offset + plan.minutes, 7 * 16 * 60, 'clamped to the end of the week');
  assert.deepEqual(nextFreeWeekOffset(state, today, 120), { date: '2026-10-06', start: 7 * 60 });
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
