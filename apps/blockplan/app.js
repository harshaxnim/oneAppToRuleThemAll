import { createAppPlatform } from '../../lib/platform.js';
import { APP_ID, APP_DETAILS } from './config.js';
import {
  PALETTE, SNAP, DAY_MINUTES, dateKey, parseDate, addDays, weekDays, weekStart, windowLength, formatDuration, formatClock,
  parseClock, clockInput, parseQuickTitle, snap, clamp, typeMap, trayBlocks, dayPlaced, weekPlaced, weekContextForDay,
  assignLanes, dayRange, totalsByType, nextFreeStart, nextFreeWeekOffset, fromWeekOffset, weekOffset, scatterKey,
  addType, updateType, deleteType, addBlock, updateBlock, deleteBlock, duplicateBlock, placeBlock, unplaceBlock,
  exportData, parseImport,
} from './model.js';
import { PlanStore } from './store.js';
import { attachDrag } from './drag.js';

const $ = selector => document.querySelector(selector);
const appUrl = new URL('./', location.href).href;
const platform = createAppPlatform({ appId: APP_ID, details: { ...APP_DETAILS, url: appUrl, iconUrl: new URL('icon.svg', appUrl).href } });
const LANE = 54, TRAY_MIN = 56;
const coarse = matchMedia('(pointer: coarse)').matches;

let view = readPref('view') === 'week' ? 'week' : 'day';
let date = dateKey(new Date());
let picked = null;
let history = [];
let geometry = null;
let pendingRender = false;
let scrollIntent = 'auto';
let lastTypeId = readPref('type');
let toastTimer = 0, toastUndo = false;
let drop = null;

const store = new PlanStore(platform, () => render());
const drag = attachDrag(document.body, { begin: dragBegin, move: dragMove, end: dragEnd, scroller: () => $('#timeline') });

function readPref(key) { try { return localStorage.getItem(`blockplan:pref:${key}`); } catch { return null; } }
function writePref(key, value) { try { localStorage.setItem(`blockplan:pref:${key}`, value); } catch { /* A convenience only. */ } }
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function announce(message) { $('#announce').textContent = ''; requestAnimationFrame(() => { $('#announce').textContent = message; }); }
function toast(message, undoable = false) {
  $('#toast-text').textContent = message;
  $('#toast-undo').hidden = !undoable || !history.length;
  toastUndo = undoable;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, undoable ? 6000 : 3800);
}
const state = () => store.state;
const types = () => typeMap(state());
const dayLength = () => windowLength(state().settings);
const step = scope => SNAP[scope];
const today = () => dateKey(new Date());
function lengthLabel(block) { return formatDuration(block.minutes, block.scope === 'week' ? { dayLength: dayLength() } : {}); }

// Every change goes through here so it can be undone.
function commit(next, message, { undoable = true, quiet = false } = {}) {
  try {
    const previous = state();
    store.replace(next);
    if (undoable) { history.push(previous); if (history.length > 50) history.shift(); }
    if (message) { announce(message); if (!quiet) toast(message, undoable); }
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}
function undo() {
  const previous = history.pop();
  if (!previous) { toast('Nothing to undo'); return; }
  try { store.replace(previous); toast('Undone'); announce('Undone'); }
  catch (error) { toast(error.message); }
}

// ---------- Geometry ----------
function computeGeometry() {
  const scroller = $('#timeline');
  const width = Math.max(280, scroller.clientWidth);
  const narrow = width < 640;
  if (view === 'day') {
    const { from, to } = dayRange(state(), date);
    const fit = width / ((to - from) / 60);
    const perHour = narrow ? Math.max(96, fit) : Math.max(64, fit);
    return { kind: 'day', from, to, ppm: perHour / 60, step: SNAP.day };
  }
  const total = 7 * dayLength();
  const fit = width / (total / 60);
  const perHour = narrow ? 26 : Math.max(9, fit);
  return { kind: 'week', from: 0, to: total, ppm: perHour / 60, step: SNAP.week, week: weekDays(date) };
}
// The tray is a zoomed-in view of the same scale: lengths stay proportional to
// each other, but short blocks remain readable. Dragging shows the true
// timeline length.
function trayScale() {
  const narrow = $('#timeline').clientWidth < 640;
  const perHour = view === 'day' ? (narrow ? 150 : 132) : (narrow ? 40 : 36);
  return Math.max(geometry.ppm, perHour / 60);
}
// Placed items as offsets on the current axis.
function placedItems() {
  if (view === 'day') return dayPlaced(state(), date).map(block => ({ block, start: block.at.start, end: block.at.start + block.minutes }));
  return weekPlaced(state(), date).map(({ block, offset }) => ({ block, start: offset, end: offset + block.minutes }));
}
function offsetToAt(offset) {
  return view === 'day' ? { date, start: offset } : fromWeekOffset(state(), offset, geometry.week);
}
function timeLabel(start, end) {
  if (view === 'day') return `${formatClock(start)} – ${formatClock(end)}`;
  const a = fromWeekOffset(state(), start, geometry.week);
  const b = fromWeekOffset(state(), Math.max(start, end - 1), geometry.week);
  const endClock = formatClock(b.start + ((end - start) ? 1 : 0));
  const dayName = key => parseDate(key).toLocaleDateString(undefined, { weekday: 'short' });
  return a.date === b.date ? `${dayName(a.date)} ${formatClock(a.start)} – ${endClock}` : `${dayName(a.date)} ${formatClock(a.start)} – ${dayName(b.date)} ${endClock}`;
}

// ---------- Rendering ----------
function render() {
  if (drag.active) { pendingRender = true; return; }
  pendingRender = false;
  renderStatus();
  if (!store.ready || !state()) {
    $('#board').setAttribute('aria-busy', 'true');
    $('#track').replaceChildren(el('p', 'loading', store.error ? store.status : 'Opening your plan…'));
    $('#tray').replaceChildren();
    return;
  }
  $('#board').removeAttribute('aria-busy');
  if (picked && !state().blocks.some(block => block.id === picked)) picked = null;
  renderHeader();
  const scroller = $('#timeline');
  const keepScroll = scroller.scrollLeft;
  geometry = computeGeometry();
  renderTimeline();
  renderTray();
  renderPickbar();
  if (scrollIntent === 'auto') { scrollToFocus(); scrollIntent = 'keep'; }
  else scroller.scrollLeft = keepScroll;
  if ($('#menu-dialog').open) renderMenu();
}
function renderStatus() {
  $('#status').textContent = store.status;
  $('#status').classList.toggle('bad', store.error);
}
function renderHeader() {
  for (const tab of document.querySelectorAll('[data-view]')) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  $('#board').setAttribute('aria-labelledby', `tab-${view}`);
  const unit = view === 'day' ? 'day' : 'week';
  $('#prev').setAttribute('aria-label', `Previous ${unit}`);
  $('#next').setAttribute('aria-label', `Next ${unit}`);
  const current = parseDate(date);
  const heading = $('#heading');
  heading.replaceChildren();
  let tag = '';
  if (view === 'day') {
    heading.append(current.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
    const delta = Math.round((current - parseDate(today())) / 86400000);
    tag = { 0: 'Today', 1: 'Tomorrow', [-1]: 'Yesterday' }[delta] ?? '';
  } else {
    const [first, , , , , , last] = weekDays(date);
    const a = parseDate(first), b = parseDate(last);
    const sameMonth = a.getMonth() === b.getMonth();
    heading.append(`${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`);
    const delta = Math.round((parseDate(first) - parseDate(weekStart(today()))) / (7 * 86400000));
    tag = { 0: 'This week', 1: 'Next week', [-1]: 'Last week' }[delta] ?? '';
  }
  if (tag) heading.append(' ', el('span', 'tag', tag));
  $('#today').setAttribute('aria-label', view === 'day' ? 'Go to today' : 'Go to this week');
  $('#today').disabled = view === 'day' ? date === today() : weekStart(date) === weekStart(today());
  // Summary doubles as the color legend.
  const items = placedItems().map(item => item.block);
  const summary = $('#summary');
  summary.replaceChildren();
  if (!items.length) {
    summary.append(el('span', 'muted', view === 'day' ? 'Nothing planned for this day yet.' : 'Nothing planned for this week yet.'));
    return;
  }
  const total = items.reduce((sum, block) => sum + block.minutes, 0);
  summary.append(el('b', '', `${formatDuration(total)} planned`));
  const byType = types();
  for (const [typeId, minutes] of [...totalsByType(items)].sort((a, b) => b[1] - a[1])) {
    const type = byType.get(typeId);
    const chip = el('span', 'sum');
    chip.style.setProperty('--c', type.color);
    chip.append(el('i'), `${type.name} ${formatDuration(minutes)}`);
    summary.append(chip);
  }
}
function blockStyle(node, block) {
  const type = types().get(block.typeId);
  node.style.setProperty('--c', type?.color ?? '#6b7785');
  return type;
}
function renderTimeline() {
  const { from, to, ppm } = geometry;
  const track = $('#track');
  const width = Math.round((to - from) * ppm);
  track.replaceChildren();
  track.style.width = `${width}px`;
  track.className = `track ${view}`;
  let top = 0;
  // Axis
  if (view === 'week') {
    const days = el('div', 'days');
    const length = dayLength();
    geometry.week.forEach((key, index) => {
      const cell = el('div', `day-label${key === today() ? ' is-today' : ''}`);
      cell.style.left = `${index * length * ppm}px`;
      cell.style.width = `${length * ppm}px`;
      const d = parseDate(key);
      const button = el('button', '', `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`);
      button.type = 'button';
      button.setAttribute('aria-label', `Open ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} in the day view`);
      button.addEventListener('click', () => { date = key; setView('day'); });
      cell.append(button);
      if (key === today()) cell.append(el('span', 'tag', 'Today'));
      days.append(cell);
    });
    track.append(days);
    top += 30;
  }
  const ticks = el('div', 'ticks');
  ticks.style.top = `${top}px`;
  const hourPx = 60 * ppm;
  const every = view === 'day' ? (hourPx >= 44 ? 60 : 120) : (hourPx * 3 >= 34 ? 180 : 360);
  const length = view === 'week' ? dayLength() : 0;
  for (let t = from; t < to; t += 60) {
    const clock = view === 'day' ? t : state().settings.dayStart + (t % length);
    const local = view === 'day' ? t - from : t % length;
    // Skip a label that would crowd the next day's first label.
    if (local % every || (view === 'week' && length - local < every * 0.6)) continue;
    const tick = el('span', `tick${view === 'week' && t % length === 0 ? ' day-start' : ''}`, formatClock(clock, { compact: true }));
    tick.style.left = `${(t - from) * ppm}px`;
    ticks.append(tick);
  }
  track.append(ticks);
  top += 22;
  // Week context strip in the day view
  if (view === 'day') {
    const context = weekContextForDay(state(), date);
    if (context.length) {
      const strip = el('div', 'context');
      strip.style.top = `${top}px`;
      strip.setAttribute('role', 'list');
      strip.setAttribute('aria-label', 'From your week plan');
      for (const item of context) {
        const bar = el('div', 'context-bar', item.block.title);
        bar.setAttribute('role', 'listitem');
        blockStyle(bar, item.block);
        bar.style.left = `${(item.start - from) * ppm}px`;
        bar.style.width = `${(item.end - item.start) * ppm}px`;
        bar.title = `Week plan: ${item.block.title}`;
        strip.append(bar);
      }
      track.append(strip);
      top += 22;
    }
  }
  // Lanes
  const items = placedItems();
  const { lanes, count } = assignLanes(items.map(item => ({ id: item.block.id, start: item.start, end: item.end })));
  const area = el('div', 'lanes');
  area.id = 'lanes';
  area.style.top = `${top}px`;
  area.style.height = `${Math.max(count, 2) * LANE + 6}px`;
  area.style.setProperty('--hour', `${hourPx}px`);
  area.style.setProperty('--day', `${dayLength() * ppm}px`);
  area.setAttribute('aria-label', picked ? 'Timeline. Choose a time to place the picked block.' : 'Timeline');
  geometry.top = top;
  geometry.count = count;
  for (const item of items) area.append(placedBlock(item, lanes.get(item.block.id)));
  if (!items.length) {
    const empty = el('p', 'lanes-empty', coarse ? 'Hold a block below and drag it here, or tap one to pick it up.' : 'Drag a block from below onto the timeline.');
    empty.style.left = `${Math.max(8, $('#timeline').scrollLeft + 8)}px`;
    area.append(empty);
  }
  if (view === 'day' && date === today()) {
    const now = new Date(), minute = now.getHours() * 60 + now.getMinutes();
    if (minute >= from && minute <= to) {
      const line = el('div', 'now');
      line.style.left = `${(minute - from) * ppm}px`;
      line.style.top = `${top - 22}px`;
      line.style.height = `${Math.max(count, 2) * LANE + 28}px`;
      line.setAttribute('aria-hidden', 'true');
      line.append(el('span', '', formatClock(minute, { compact: true })));
      track.append(line);
    }
  }
  if (view === 'week') {
    const index = geometry.week.indexOf(today());
    if (index >= 0) {
      const shade = el('div', 'today-shade');
      shade.style.left = `${index * dayLength() * ppm}px`;
      shade.style.width = `${dayLength() * ppm}px`;
      area.append(shade);
    }
  }
  track.append(area);
  track.style.height = `${top + Math.max(count, 2) * LANE + 8}px`;
}
function placedBlock(item, lane) {
  const { block } = item;
  const node = el('div', `block placed${block.done ? ' done' : ''}`);
  node.dataset.id = block.id;
  node.dataset.drag = 'move';
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  const type = blockStyle(node, block);
  const widthPx = (item.end - item.start) * geometry.ppm;
  node.style.left = `${(item.start - geometry.from) * geometry.ppm}px`;
  node.style.width = `${widthPx}px`;
  node.style.top = `${lane * LANE + 4}px`;
  if (widthPx < 44) node.classList.add('tiny');
  const when = timeLabel(item.start, item.end);
  node.setAttribute('aria-label', `${block.done ? 'Done: ' : ''}${block.title}, ${type?.name ?? ''}, ${when}, ${lengthLabel(block)}`);
  node.setAttribute('aria-describedby', 'hint-keys');
  node.title = `${block.title} · ${when}`;
  const title = el('span', 'b-title');
  if (block.done) title.append(el('span', 'tick-mark', '✓ '));
  title.append(block.title);
  node.append(title, el('span', 'b-meta', view === 'day' ? `${formatClock(item.start, { compact: true })} · ${lengthLabel(block)}` : lengthLabel(block)));
  const handle = el('span', 'resize');
  handle.dataset.drag = 'resize';
  handle.setAttribute('aria-hidden', 'true');
  node.append(handle);
  node.addEventListener('click', () => openBlockSheet({ id: block.id }));
  node.addEventListener('keydown', event => placedKeys(event, block));
  return node;
}
function renderTray() {
  const scope = view;
  const blocks = trayBlocks(state(), scope);
  const tray = $('#tray');
  tray.replaceChildren();
  $('#tray-title').textContent = scope === 'day' ? `To plan · ${blocks.length}` : `To plan this week · ${blocks.length}`;
  $('#tray-hint').textContent = coarse ? 'Hold to drag, or tap to pick up' : 'Drag to the timeline, or click to pick up';
  const max = tray.clientWidth || 320;
  const ppm = trayScale();
  for (const block of blocks) {
    const node = el('button', `block tray-block${picked === block.id ? ' picked' : ''}`);
    node.type = 'button';
    node.dataset.id = block.id;
    node.dataset.drag = 'move';
    const type = blockStyle(node, block);
    const trueWidth = block.minutes * ppm;
    node.style.width = `${Math.min(max, Math.max(TRAY_MIN, trueWidth))}px`;
    if (trueWidth > max) node.classList.add('overflow');
    // A small, stable vertical jitter makes the tray read as a loose pile.
    node.style.marginTop = `${(scatterKey(block.id) % 3) * 5}px`;
    node.setAttribute('aria-pressed', String(picked === block.id));
    node.setAttribute('aria-label', `${block.title}, ${type?.name ?? ''}, ${lengthLabel(block)}${block.reusable ? ', reusable' : ''}. ${picked === block.id ? 'Picked up.' : 'Pick up to place.'}`);
    const title = el('span', 'b-title', block.title);
    const meta = el('span', 'b-meta', lengthLabel(block));
    if (block.reusable) meta.append(el('span', 'reuse', ' ↻'));
    node.append(title, meta);
    node.addEventListener('click', () => pick(picked === block.id ? null : block.id));
    tray.append(node);
  }
  if (!blocks.length) {
    const empty = el('div', 'tray-empty');
    empty.append(el('p', '', scope === 'day' ? 'Everything is planned.' : 'Every week block is planned.'));
    const add = el('button', 'soft-btn', scope === 'day' ? 'New block' : 'New week block');
    add.type = 'button';
    add.addEventListener('click', () => openBlockSheet({}));
    empty.append(add);
    tray.append(empty);
  }
}
function renderPickbar() {
  const bar = $('#pickbar');
  const block = picked && state().blocks.find(item => item.id === picked);
  bar.hidden = !block;
  document.body.classList.toggle('has-pick', Boolean(block));
  if (!block) return;
  $('#pick-text').textContent = `${coarse ? 'Tap' : 'Click'} the timeline to place “${block.title}” (${lengthLabel(block)})`;
}
function scrollToFocus() {
  const scroller = $('#timeline');
  const items = placedItems();
  let target;
  if (view === 'day') {
    const now = new Date();
    target = date === today() ? now.getHours() * 60 + now.getMinutes() - 60 : (items[0]?.start ?? state().settings.dayStart) - 30;
  } else {
    const index = geometry.week.indexOf(today());
    target = index > 0 ? index * dayLength() : 0;
  }
  scroller.scrollLeft = Math.max(0, (target - geometry.from) * geometry.ppm);
}

// ---------- Picking and placing ----------
function pick(id) {
  picked = id;
  render();
  if (id) {
    const block = state().blocks.find(item => item.id === id);
    announce(`Picked up ${block.title}. Choose a time on the timeline, or use Next free time.`);
    if (!coarse) $('#pick-auto').focus();
  }
}
function place(id, at, verb = 'Placed') {
  const block = state().blocks.find(item => item.id === id);
  if (!block) return;
  try {
    const result = placeBlock(state(), id, at);
    const placed = result.state.blocks.find(item => item.id === result.id);
    picked = null;
    const where = block.scope === 'day' ? formatClock(placed.at.start) : `${parseDate(placed.at.date).toLocaleDateString(undefined, { weekday: 'long' })} ${formatClock(placed.at.start)}`;
    if (commit(result.state, `${verb} ${block.title} at ${where}`, { quiet: true })) {
      requestAnimationFrame(() => document.querySelector(`.placed[data-id="${result.id}"]`)?.classList.add('arrived'));
    }
  } catch (error) { toast(error.message); }
}
function placeNextFree(id) {
  const block = state().blocks.find(item => item.id === id);
  if (!block) return;
  if (block.scope === 'day') {
    const now = new Date();
    const fromMinute = date === today() ? now.getHours() * 60 + now.getMinutes() : state().settings.dayStart;
    const start = nextFreeStart(state(), date, block.minutes, fromMinute);
    if (start === null) { toast(`No free ${lengthLabel(block)} left in this day’s planning hours`); return; }
    place(id, { date, start });
  } else {
    const at = nextFreeWeekOffset(state(), date, block.minutes);
    if (!at) { toast(`No free ${lengthLabel(block)} left this week`); return; }
    place(id, at);
  }
  scrollToBlock();
}
function scrollToBlock() {
  requestAnimationFrame(() => {
    const node = document.querySelector('.placed.arrived');
    if (!node) return;
    const scroller = $('#timeline');
    const left = node.offsetLeft, right = left + node.offsetWidth;
    if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left - 24;
  });
}
function laneOffsetAt(clientX) {
  const rect = $('#lanes').getBoundingClientRect();
  return (clientX - rect.left) / geometry.ppm + geometry.from;
}
$('#track').addEventListener('click', event => {
  if (!store.ready || event.target.closest('.placed, .day-label')) return;
  const lanes = $('#lanes');
  if (!lanes) return;
  const offset = Math.floor(laneOffsetAt(event.clientX) / geometry.step) * geometry.step;
  if (offset < geometry.from || offset >= geometry.to) return;
  if (picked) { place(picked, offsetToAt(offset)); return; }
  // Tapping an empty time makes a new block there.
  openBlockSheet({ placeAt: offsetToAt(offset) });
});
function placedKeys(event, block) {
  const moveKeys = { ArrowLeft: -1, ArrowRight: 1 };
  if (event.key in moveKeys) {
    event.preventDefault();
    const direction = moveKeys[event.key];
    const stepSize = step(block.scope);
    if (event.shiftKey) {
      const start = block.scope === 'day' ? block.at.start : weekOffset(state(), block.at.date, block.at.start, weekDays(block.at.date));
      const minutes = clamp(block.minutes + direction * stepSize, stepSize, (block.scope === 'day' ? DAY_MINUTES : geometry.to) - start);
      if (minutes === block.minutes) return;
      commitKeep(updateBlock(state(), block.id, { minutes }), `${block.title} now ${formatDuration(minutes, block.scope === 'week' ? { dayLength: dayLength() } : {})}`, block.id);
    } else {
      const offset = block.scope === 'day' ? block.at.start : weekOffset(state(), block.at.date, block.at.start, weekDays(block.at.date));
      const result = placeBlock(state(), block.id, offsetToAt(offset + direction * stepSize));
      const moved = result.state.blocks.find(item => item.id === block.id);
      commitKeep(result.state, `${block.title} at ${timeLabelFor(moved)}`, block.id);
    }
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    commit(unplaceBlock(state(), block.id), `${block.title} moved back to the tray`);
    $('#tray').querySelector(`[data-id="${block.id}"]`)?.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openBlockSheet({ id: block.id });
  }
}
function timeLabelFor(block) {
  if (block.scope === 'day') return formatClock(block.at.start);
  return `${parseDate(block.at.date).toLocaleDateString(undefined, { weekday: 'short' })} ${formatClock(block.at.start)}`;
}
function commitKeep(next, message, focusId) {
  if (!commit(next, message, { quiet: true })) return;
  const node = document.querySelector(`.placed[data-id="${focusId}"]`);
  node?.focus({ preventScroll: true });
  if (node) {
    const scroller = $('#timeline');
    if (node.offsetLeft < scroller.scrollLeft) scroller.scrollLeft = node.offsetLeft - 16;
    else if (node.offsetLeft + node.offsetWidth > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = node.offsetLeft + node.offsetWidth - scroller.clientWidth + 16;
  }
}

// ---------- Dragging ----------
function dragBegin({ el: node, mode, id }) {
  if (!store.ready) return null;
  const block = state().blocks.find(item => item.id === id);
  if (!block) return null;
  if (picked) { picked = null; renderPickbar(); $('#tray').querySelector('.picked')?.classList.remove('picked'); }
  drop = { id, mode, block, target: null, minutes: block.minutes };
  if (mode === 'resize') return { width: node.getBoundingClientRect().width };
  return { width: Math.max(18, block.minutes * geometry.ppm) };
}
function dragMove({ clientX, clientY, left, mode, el: node, x: startX }) {
  if (!drop) return;
  const { block } = drop;
  if (mode === 'resize') {
    const stepSize = step(block.scope);
    const start = block.scope === 'day' ? block.at.start : weekOffset(state(), block.at.date, block.at.start, weekDays(block.at.date));
    // Relative to where the edge was grabbed, so the handle never jumps.
    const minutes = clamp(snap(block.minutes + (clientX - startX) / geometry.ppm, stepSize), stepSize, geometry.to - start);
    drop.minutes = minutes;
    node.style.width = `${minutes * geometry.ppm}px`;
    node.querySelector('.b-meta').textContent = block.scope === 'day' ? `${formatClock(block.at.start, { compact: true })} · ${formatDuration(minutes)}` : formatDuration(minutes, { dayLength: dayLength() });
    return;
  }
  const card = $('.timeline-card').getBoundingClientRect();
  const trayCard = $('#tray-card').getBoundingClientRect();
  const preview = ensurePreview();
  $('#tray-card').classList.remove('drop-unplan');
  if (clientY >= card.top - 24 && clientY <= card.bottom + 16) {
    const offset = clamp(snap(laneOffsetAt(left), geometry.step), geometry.from, Math.max(geometry.from, geometry.to - block.minutes));
    drop.target = { kind: 'timeline', offset };
    const others = placedItems().filter(item => item.block.id !== block.id).map(item => ({ id: item.block.id, start: item.start, end: item.end }));
    const { lanes, count } = assignLanes([...others, { id: '__drop', start: offset, end: offset + block.minutes }]);
    preview.hidden = false;
    preview.style.left = `${(offset - geometry.from) * geometry.ppm}px`;
    preview.style.width = `${block.minutes * geometry.ppm}px`;
    preview.style.top = `${lanes.get('__drop') * LANE + 4}px`;
    preview.textContent = timeLabel(offset, offset + block.minutes);
    $('#lanes').style.height = `${Math.max(geometry.count, count, 2) * LANE + 6}px`;
  } else if (block.at && clientY >= trayCard.top - 16) {
    drop.target = { kind: 'tray' };
    preview.hidden = true;
    $('#tray-card').classList.add('drop-unplan');
  } else {
    drop.target = null;
    preview.hidden = true;
  }
}
function ensurePreview() {
  let preview = $('#drop-preview');
  if (!preview) {
    preview = el('div', 'drop-preview');
    preview.id = 'drop-preview';
    preview.setAttribute('aria-hidden', 'true');
    $('#lanes').append(preview);
  }
  return preview;
}
function dragEnd({ commit: ok, mode }) {
  const session = drop;
  drop = null;
  $('#drop-preview')?.remove();
  $('#tray-card').classList.remove('drop-unplan');
  if (!session || !ok) { render(); return; }
  const { block } = session;
  if (mode === 'resize') {
    if (session.minutes !== block.minutes) {
      commit(updateBlock(state(), block.id, { minutes: session.minutes }), `${block.title} now ${formatDuration(session.minutes, block.scope === 'week' ? { dayLength: dayLength() } : {})}`, { quiet: true });
    } else render();
  } else if (session.target?.kind === 'timeline') {
    place(block.id, offsetToAt(session.target.offset), block.at ? 'Moved' : 'Placed');
  } else if (session.target?.kind === 'tray') {
    commit(unplaceBlock(state(), block.id), `${block.title} moved back to the tray`);
  } else render();
  if (pendingRender) render();
}

// ---------- Block sheet ----------
const sheet = { id: null, scope: 'day', draft: null, placeAt: null, newColor: null };
function presetsFor(scope) {
  if (scope === 'day') return [15, 30, 45, 60, 90, 120, 180];
  const length = dayLength();
  return [60, 120, length / 2, length, length * 2].filter(value => value % 60 === 0);
}
function openBlockSheet({ id = null, placeAt = null }) {
  if (!store.ready) return;
  const existing = id ? state().blocks.find(block => block.id === id) : null;
  const scope = existing?.scope ?? view;
  const firstType = state().types.find(type => type.id === lastTypeId) ?? state().types[0];
  sheet.id = existing?.id ?? null;
  sheet.scope = scope;
  sheet.placeAt = placeAt;
  sheet.draft = existing ? structuredClone(existing) : { title: '', typeId: firstType?.id ?? null, minutes: scope === 'day' ? 60 : 240, reusable: false, at: null, done: false, scope };
  $('#block-title').textContent = existing ? 'Edit block' : scope === 'day' ? 'New block' : 'New week block';
  $('#f-title').value = existing?.title ?? '';
  $('#f-title').placeholder = scope === 'day' ? 'e.g. Write report 90m' : 'e.g. Plan the offsite 1d';
  $('#block-error').textContent = '';
  $('#new-type').hidden = true;
  $('#f-delete').hidden = !existing;
  $('#f-duplicate').hidden = !existing;
  $('#f-save').textContent = existing ? 'Save' : placeAt ? 'Add to timeline' : 'Add to tray';
  renderSheet();
  picked = null;
  renderPickbar();
  $('#block-dialog').showModal();
  if (!existing || !coarse) $('#f-title').focus();
}
function renderSheet() {
  const { draft, scope } = sheet;
  // Types
  const chips = $('#f-types');
  chips.replaceChildren();
  for (const type of state().types) {
    const chip = el('button', 'chip type-chip');
    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(type.id === draft.typeId));
    chip.style.setProperty('--c', type.color);
    chip.append(el('i'), type.name);
    chip.addEventListener('click', () => { draft.typeId = type.id; renderSheet(); });
    chips.append(chip);
  }
  const addChip = el('button', 'chip add-chip', '+ New type');
  addChip.type = 'button';
  addChip.setAttribute('aria-expanded', String(!$('#new-type').hidden));
  addChip.addEventListener('click', () => openNewType());
  chips.append(addChip);
  // Length
  const presets = $('#f-presets');
  presets.replaceChildren();
  const labelOptions = scope === 'week' ? { dayLength: dayLength() } : {};
  for (const minutes of presetsFor(scope)) {
    const chip = el('button', 'chip', formatDuration(minutes, labelOptions));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(minutes === draft.minutes));
    chip.addEventListener('click', () => { draft.minutes = minutes; renderSheet(); });
    presets.append(chip);
  }
  $('#f-length').textContent = formatDuration(draft.minutes, labelOptions);
  $('#f-less').disabled = draft.minutes <= step(scope);
  // When
  const when = $('#f-when');
  when.replaceChildren();
  const existing = sheet.id && state().blocks.find(block => block.id === sheet.id);
  if (existing?.at) {
    const row = el('div', 'when-row');
    if (scope === 'week') {
      const label = el('label', 'field compact');
      label.append(el('span', '', 'Day'));
      const select = el('select');
      select.id = 'f-day';
      for (const key of weekDays(draft.at.date)) {
        const option = el('option', '', parseDate(key).toLocaleDateString(undefined, { weekday: 'long' }));
        option.value = key;
        option.selected = key === draft.at.date;
        select.append(option);
      }
      select.addEventListener('change', () => { draft.at.date = select.value; });
      label.append(select);
      row.append(label);
    }
    const label = el('label', 'field compact');
    label.append(el('span', '', 'Starts'));
    const input = el('input');
    input.type = 'time';
    input.id = 'f-start';
    input.step = String(step(scope) * 60);
    input.value = clockInput(draft.at.start);
    input.addEventListener('change', () => {
      const value = parseClock(input.value);
      if (value !== null) draft.at.start = snap(value, step(scope));
    });
    label.append(input);
    row.append(label);
    when.append(row);
    const done = el('label', 'check');
    const box = el('input');
    box.type = 'checkbox';
    box.id = 'f-done';
    box.checked = draft.done;
    box.addEventListener('change', () => { draft.done = box.checked; });
    const text = el('span');
    text.append(el('b', '', 'Done'));
    done.append(box, text);
    when.append(done);
    const unplan = el('button', 'soft-btn', 'Move back to tray');
    unplan.type = 'button';
    unplan.addEventListener('click', () => {
      $('#block-dialog').close();
      commit(unplaceBlock(state(), existing.id), `${existing.title} moved back to the tray`);
    });
    when.append(unplan);
  } else if (existing) {
    const button = el('button', 'soft-btn', scope === 'day' ? `Place at next free time ${date === today() ? 'today' : 'this day'}` : 'Place at next free time this week');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!saveSheet({ close: false })) return;
      $('#block-dialog').close();
      placeNextFree(existing.id);
    });
    when.append(button);
  } else if (sheet.placeAt) {
    const at = sheet.placeAt;
    when.append(el('p', 'muted', scope === 'day' ? `Starts at ${formatClock(at.start)}` : `Starts ${parseDate(at.date).toLocaleDateString(undefined, { weekday: 'long' })} at ${formatClock(at.start)}`));
  }
  $('#f-reusable-row').hidden = Boolean(existing?.at || sheet.placeAt);
  $('#f-reusable').checked = draft.reusable;
}
function openNewType() {
  const box = $('#new-type');
  box.hidden = false;
  $('#nt-name').value = '';
  const used = new Set(state().types.map(type => type.color));
  sheet.newColor = (PALETTE.find(item => !used.has(item.color)) ?? PALETTE[0]).color;
  const choose = color => { sheet.newColor = color; renderSwatches($('#nt-colors'), color, choose); };
  choose(sheet.newColor);
  renderSheet();
  $('#nt-name').focus();
}
function renderSwatches(container, selected, onPick) {
  container.replaceChildren();
  for (const { color, name } of PALETTE) {
    const swatch = el('button', 'swatch');
    swatch.type = 'button';
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-checked', String(color === selected));
    swatch.setAttribute('aria-label', name);
    swatch.title = name;
    swatch.style.setProperty('--c', color);
    swatch.addEventListener('click', () => onPick(color));
    container.append(swatch);
  }
}
function saveNewType() {
  try {
    const result = addType(state(), { name: $('#nt-name').value, color: sheet.newColor });
    if (!commit(result.state, `Added type ${result.type.name}`, { quiet: true })) return;
    sheet.draft.typeId = result.type.id;
    $('#new-type').hidden = true;
    renderSheet();
    $('#f-types').querySelector('[aria-checked="true"]')?.focus();
  } catch (error) { $('#block-error').textContent = error.message; }
}
function saveSheet({ close = true } = {}) {
  const { draft, scope } = sheet;
  const parsed = parseQuickTitle($('#f-title').value, { dayLength: dayLength() });
  draft.title = parsed.title;
  draft.reusable = $('#f-reusable').checked;
  if (!draft.typeId) { $('#block-error').textContent = 'Make a type first: choose + New type.'; return false; }
  try {
    let next, message, id = sheet.id;
    if (id) {
      next = updateBlock(state(), id, { title: draft.title, typeId: draft.typeId, minutes: draft.minutes, reusable: draft.reusable, done: draft.done });
      if (draft.at) next = placeBlock(next, id, draft.at).state;
      message = `Saved ${draft.title}`;
    } else {
      const result = addBlock(state(), { title: draft.title, typeId: draft.typeId, minutes: draft.minutes, reusable: draft.reusable && !sheet.placeAt, scope });
      next = result.state; id = result.block.id;
      if (sheet.placeAt) next = placeBlock(next, id, sheet.placeAt).state;
      message = sheet.placeAt ? `Added ${draft.title} to the timeline` : `Added ${draft.title} to the tray`;
    }
    lastTypeId = draft.typeId;
    writePref('type', lastTypeId);
    if (!commit(next, message, { quiet: true })) return false;
    if (close) {
      $('#block-dialog').close();
      const node = document.querySelector(`[data-id="${id}"]`);
      node?.classList.add('arrived');
      node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return true;
  } catch (error) {
    $('#block-error').textContent = error.message;
    return false;
  }
}
$('#f-title').addEventListener('input', () => {
  const parsed = parseQuickTitle($('#f-title').value, { dayLength: dayLength() });
  if (parsed.minutes) {
    const minutes = clamp(snap(parsed.minutes, step(sheet.scope)), step(sheet.scope), sheet.scope === 'day' ? DAY_MINUTES : 7 * DAY_MINUTES);
    if (minutes !== sheet.draft.minutes) { sheet.draft.minutes = minutes; renderSheet(); }
  }
});
$('#f-less').addEventListener('click', () => { sheet.draft.minutes = Math.max(step(sheet.scope), sheet.draft.minutes - step(sheet.scope)); renderSheet(); });
$('#f-more').addEventListener('click', () => { sheet.draft.minutes = Math.min(sheet.scope === 'day' ? DAY_MINUTES : 7 * DAY_MINUTES, sheet.draft.minutes + step(sheet.scope)); renderSheet(); });
$('#f-reusable').addEventListener('change', () => { sheet.draft.reusable = $('#f-reusable').checked; });
$('#block-form').addEventListener('submit', event => { event.preventDefault(); saveSheet(); });
$('#nt-save').addEventListener('click', saveNewType);
$('#nt-name').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveNewType(); } });
$('#nt-cancel').addEventListener('click', () => { $('#new-type').hidden = true; renderSheet(); });
$('#f-delete').addEventListener('click', () => {
  const block = state().blocks.find(item => item.id === sheet.id);
  $('#block-dialog').close();
  if (block) commit(deleteBlock(state(), block.id), `Deleted ${block.title}`);
});
$('#f-duplicate').addEventListener('click', () => {
  const block = state().blocks.find(item => item.id === sheet.id);
  if (!block) return;
  $('#block-dialog').close();
  const result = duplicateBlock(state(), block.id);
  commit(result.state, `Copied ${block.title} to the tray`);
});

// ---------- Menu ----------
function renderMenu() {
  const user = platform.getCurrentUser();
  $('#account-text').textContent = user ? `Signed in as ${user.email ?? user.displayName ?? 'your Google account'}. ${store.status}.` : `${store.status || 'Saved on this device'}. Sign in to keep your plan in sync across devices.`;
  $('#account-button').textContent = user ? 'Sign out' : 'Sign in with Google to sync';
  const list = $('#type-list');
  const focusedId = document.activeElement?.closest?.('#type-list li')?.dataset.id;
  list.replaceChildren();
  const counts = new Map();
  for (const block of state().blocks) counts.set(block.typeId, (counts.get(block.typeId) ?? 0) + 1);
  for (const type of state().types) {
    const item = el('li');
    item.dataset.id = type.id;
    const swatch = el('button', 'swatch big');
    swatch.type = 'button';
    swatch.style.setProperty('--c', type.color);
    swatch.setAttribute('aria-label', `Change color of ${type.name}`);
    swatch.setAttribute('aria-expanded', 'false');
    const name = el('input');
    name.value = type.name;
    name.maxLength = 32;
    name.setAttribute('aria-label', `Name of type ${type.name}`);
    const save = () => {
      if (name.value.trim() === type.name) return;
      try { commit(updateType(state(), type.id, { name: name.value }), `Renamed type to ${name.value.trim()}`, { quiet: true }); }
      catch (error) { toast(error.message); name.value = type.name; }
    };
    name.addEventListener('change', save);
    name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); name.blur(); } });
    const count = el('span', 'count', `${counts.get(type.id) ?? 0}`);
    count.setAttribute('aria-label', `${counts.get(type.id) ?? 0} blocks`);
    const remove = el('button', 'icon-btn', '✕');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete type ${type.name}`);
    remove.addEventListener('click', () => confirmDeleteType(type, counts.get(type.id) ?? 0));
    const colors = el('div', 'swatches');
    colors.hidden = true;
    colors.setAttribute('role', 'radiogroup');
    colors.setAttribute('aria-label', `Color for ${type.name}`);
    renderSwatches(colors, type.color, color => commit(updateType(state(), type.id, { color }), `${type.name} recolored`, { quiet: true }));
    swatch.addEventListener('click', () => { colors.hidden = !colors.hidden; swatch.setAttribute('aria-expanded', String(!colors.hidden)); });
    item.append(swatch, name, count, remove, colors);
    list.append(item);
  }
  if (focusedId) list.querySelector(`li[data-id="${focusedId}"] input`)?.focus();
  const hours = [$('#s-start'), $('#s-end')];
  const { dayStart, dayEnd } = state().settings;
  hours[0].replaceChildren(...Array.from({ length: 21 }, (_, hour) => option(hour * 60, dayStart, hour * 60 > dayEnd - 240)));
  hours[1].replaceChildren(...Array.from({ length: 21 }, (_, index) => option((index + 4) * 60, dayEnd, (index + 4) * 60 < dayStart + 240)));
}
function option(value, selected, disabled) {
  const node = el('option', '', value === DAY_MINUTES ? 'Midnight' : formatClock(value));
  node.value = String(value);
  node.selected = value === selected;
  node.disabled = disabled;
  return node;
}
function confirmDeleteType(type, count) {
  $('#confirm-title').textContent = `Delete ${type.name}?`;
  $('#confirm-text').textContent = count ? `This also deletes its ${count} block${count === 1 ? '' : 's'}, including any on your timeline. You can undo this right after.` : 'No blocks use this type.';
  const dialog = $('#confirm-dialog');
  $('#confirm-ok').onclick = () => {
    dialog.close();
    commit(deleteType(state(), type.id), `Deleted type ${type.name}${count ? ` and ${count} block${count === 1 ? '' : 's'}` : ''}`);
  };
  dialog.showModal();
}
$('#menu-button').addEventListener('click', () => { if (!store.ready) return; renderMenu(); $('#menu-dialog').showModal(); });
$('#menu-new-type').addEventListener('click', () => {
  const used = new Set(state().types.map(type => type.color));
  const color = (PALETTE.find(item => !used.has(item.color)) ?? PALETTE[state().types.length % PALETTE.length]).color;
  let index = 1;
  while (state().types.some(type => type.name.toLowerCase() === `new type ${index}`)) index++;
  try {
    const result = addType(state(), { name: `New type ${index}`, color });
    commit(result.state, `Added ${result.type.name}`, { quiet: true });
    const input = $(`#type-list li[data-id="${result.type.id}"] input`);
    input?.focus(); input?.select();
  } catch (error) { toast(error.message); }
});
for (const select of [$('#s-start'), $('#s-end')]) {
  select.addEventListener('change', () => {
    const settings = { dayStart: Number($('#s-start').value), dayEnd: Number($('#s-end').value) };
    commit({ ...state(), settings }, `Planning hours ${formatClock(settings.dayStart)} to ${settings.dayEnd === DAY_MINUTES ? 'midnight' : formatClock(settings.dayEnd)}`);
  });
}
$('#account-button').addEventListener('click', async () => {
  const button = $('#account-button');
  button.disabled = true;
  try {
    if (platform.getCurrentUser()) await platform.signOut();
    else await platform.signIn();
  } catch (error) {
    toast(error?.code === 'auth/popup-blocked' ? 'Allow pop-ups for this site to sign in.' : 'Sign-in did not finish. Try again.');
  } finally { button.disabled = false; }
});
$('#export').addEventListener('click', () => {
  const blob = new Blob([exportData(state())], { type: 'application/json' });
  const link = el('a');
  link.href = URL.createObjectURL(blob);
  link.download = `blockplan-${today()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Exported your plan');
});
$('#import').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const next = parseImport(await file.text());
    $('#confirm-title').textContent = 'Replace your plan?';
    $('#confirm-text').textContent = `The backup has ${next.types.length} types and ${next.blocks.length} blocks. It replaces everything in your current plan. You can undo this right after.`;
    $('#confirm-ok').textContent = 'Replace';
    $('#confirm-ok').onclick = () => { $('#confirm-dialog').close(); $('#menu-dialog').close(); commit(next, 'Imported your plan'); };
    $('#confirm-dialog').showModal();
  } catch (error) { toast(error.message); }
});
$('#confirm-dialog').addEventListener('close', () => { $('#confirm-ok').textContent = 'Delete'; });

// ---------- Navigation and global controls ----------
function setView(next) {
  view = next;
  writePref('view', view);
  picked = null;
  scrollIntent = 'auto';
  render();
}
for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => setView(tab.dataset.view));
$('.seg').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  setView(view === 'day' ? 'week' : 'day');
  $(`#tab-${view}`).focus();
});
function shiftDate(direction) { date = addDays(date, direction * (view === 'day' ? 1 : 7)); scrollIntent = 'auto'; render(); }
$('#prev').addEventListener('click', () => shiftDate(-1));
$('#next').addEventListener('click', () => shiftDate(1));
$('#today').addEventListener('click', () => { date = today(); scrollIntent = 'auto'; render(); });
$('#add').addEventListener('click', () => openBlockSheet({}));
$('#pick-auto').addEventListener('click', () => picked && placeNextFree(picked));
$('#pick-edit').addEventListener('click', () => picked && openBlockSheet({ id: picked }));
$('#pick-cancel').addEventListener('click', () => {
  const id = picked;
  pick(null);
  $('#tray').querySelector(`[data-id="${id}"]`)?.focus();
});
$('#toast-undo').addEventListener('click', () => { $('#toast').hidden = true; undo(); });
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}
document.addEventListener('keydown', event => {
  const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    undo();
  } else if (event.key === 'Escape' && picked && !document.querySelector('dialog[open]')) {
    pick(null);
  } else if (event.key === 'n' && !typing && !event.metaKey && !event.ctrlKey && !document.querySelector('dialog[open]') && store.ready) {
    event.preventDefault();
    openBlockSheet({});
  }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
window.addEventListener('online', () => store.reconnect());
window.addEventListener('offline', () => store.reconnect());
setInterval(() => {
  // Keep the now-line honest and roll over at midnight.
  if (!document.hidden && store.ready && !drag.active && !document.querySelector('dialog[open]')) render();
}, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && store.ready) render(); });

render();
// Undo never crosses accounts: a device plan must not be restored over an account plan.
function switchUser(user) { history = []; picked = null; store.switchUser(user); }
platform.onUserChanged(switchUser, () => switchUser(null));
