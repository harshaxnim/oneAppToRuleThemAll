// Snapshot of the Oct 8 SF Tech Week calendar joined with each event's Partiful
// location. c is the location visibility: public, hidden, vague, virtual, none.
import DATA from './events.json';

const TZ = 'America/Los_Angeles';
const DAY = '2026-10-08';
const CAT = { public: 'Public address', hidden: 'Address hidden', vague: 'Area only', virtual: 'Virtual', none: 'No location' };
const H0 = 7, H1 = 24;
const $ = id => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtHour = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const fmtMin = new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: 'numeric' });
const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const hourOf = ms => +fmtHour.format(ms) + +fmtMin.format(ms) / 60;
const t = ms => fmtTime.format(ms).replace(':00', '').replace(' AM', 'am').replace(' PM', 'pm');
const hourLabel = h => h === 12 ? '12pm' : h === 24 || h === 0 ? '12am' : h > 12 ? `${h - 12}pm` : `${h}am`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const mobile = () => matchMedia('(max-width: 760px)').matches;

DATA.forEach((d, i) => {
  d.i = i;
  d.sh = hourOf(d.s);
  d.eh = d.e ? hourOf(d.e) : Math.min(d.sh + 2, 24);
  if (d.eh < d.sh) d.eh = 24;
  d.bucket = d.sh < 12 ? 'm' : d.sh < 17 ? 'a' : 'e';
  // A few Partiful pages disagree with the Tech Week date; say so instead of hiding it.
  d.off = fmtDate.format(d.s) !== DAY ? fmtDay.format(d.s) : null;
  d.hay = [d.t, d.h, d.a, d.v, d.n, (d.f || []).join(' ')].join(' ').toLowerCase();
});
const colorOf = d => css(d.bucket === 'm' ? '--morning' : d.bucket === 'a' ? '--afternoon' : '--evening');
const when = d => t(d.s) + (d.e ? ` – ${t(d.e)}` : '') + (d.off ? ` (Partiful says ${d.off})` : '');
const place = d => (d.v ? `${d.v} · ` : '') + (d.a || '');
const directions = d => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place(d).replace(' · ', ', '));
const links = d => `<a href="${esc(d.u)}" target="_blank" rel="noopener">Partiful</a>${d.w ? `<a href="${esc(d.w)}" target="_blank" rel="noopener">Tech Week</a>` : ''}`;

const count = c => DATA.filter(d => d.c === c).length;
$('stats').innerHTML = `<b>${count('public')}</b> of ${DATA.length} events show a public address · ${count('hidden')} hidden until approved · ${count('vague') + count('virtual') + count('none')} area only, virtual, or none`;

const state = { view: 'cal', q: '', tod: 'all', showHidden: false, openOnly: false, sel: null };
try { Object.assign(state, JSON.parse(localStorage.getItem('sf-tech-week-oct-8') || '{}'), { q: '', sel: null }); } catch { /* storage unavailable */ }
const save = () => { try { localStorage.setItem('sf-tech-week-oct-8', JSON.stringify({ view: state.view, tod: state.tod, showHidden: state.showHidden, openOnly: state.openOnly })); } catch { /* storage unavailable */ } };

function filtered() {
  const now = Date.now(), words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return DATA.filter(d => {
    if (!state.showHidden && d.c !== 'public') return false;
    if (state.openOnly && d.r && d.r !== 'open') return false;
    if (!words.every(w => d.hay.includes(w))) return false;
    if (state.tod === 'up') return (d.e || d.s + 7.2e6) > now;
    return state.tod === 'all' || d.bucket === state.tod;
  }).sort((a, b) => a.sh - b.sh || a.t.localeCompare(b.t));
}

// Calendar
function renderCal(list) {
  const pct = h => `${(Math.max(H0, Math.min(H1, h)) - H0) / (H1 - H0) * 100}%`;
  const step = mobile() ? 3 : 1;
  let ticks = '', grid = '';
  for (let h = H0; h <= H1; h++) {
    if (h < H1 && (h - H0) % step === 0) ticks += `<span class="tick" style="left:${pct(h)}">${hourLabel(h)}</span>`;
    grid += `<div class="gl" style="left:${pct(h)}"></div>`;
  }
  const nowH = hourOf(Date.now());
  if (fmtDate.format(Date.now()) === DAY && nowH >= H0) grid += `<div class="nowline" style="left:${pct(nowH)}"><span>now ${t(Date.now())}</span></div>`;
  let rows = '', lastH = -1;
  for (const d of list) {
    const hh = Math.floor(d.sh);
    if (hh !== lastH) { rows += `<div class="hourhead">${hourLabel(hh)}</div>`; lastH = hh; }
    const pills = (d.c !== 'public' ? `<span class="pill">${CAT[d.c]}</span>` : '') + (d.off ? `<span class="pill warn">Partiful: ${d.off}</span>` : '');
    rows += `<button type="button" class="row${state.sel === d.i ? ' sel' : ''}" data-i="${d.i}" aria-label="${esc(`${d.t}, ${when(d)}, ${d.c === 'public' ? place(d) : CAT[d.c]}`)}">
      <span class="lab"><span class="tm">${t(d.s)}</span><span class="dot" style="background:${d.c === 'public' ? colorOf(d) : css('--hidden')}"></span><span class="tt">${esc(d.t)}</span>${pills}</span>
      <span class="track"><span class="bar${d.e ? '' : ' noend'}${d.c !== 'public' ? ' hid' : ''}" style="left:${pct(d.sh)};width:calc(${pct(d.eh)} - ${pct(d.sh)});background:${colorOf(d)}"></span></span></button>`;
  }
  $('cal').innerHTML = `<div class="axis"><div class="gutter"></div><div class="ticks">${ticks}</div></div>
    <div class="rows"><div class="grid">${grid}</div>${rows || '<p class="empty">No events match these filters.</p>'}</div>`;
  $('cal').querySelectorAll('.row').forEach(row => row.onclick = () => openDetail(+row.dataset.i));
}

// Map
let map, cluster, markers = {};
function initMap() {
  if (map) return true;
  if (!window.L) { $('map').innerHTML = '<p class="map-error">The map library could not load. Check your connection, or use the List view.</p>'; return false; }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  map = L.map('map', { maxZoom: 16, zoomAnimation: !reduce, fadeAnimation: !reduce }).setView([37.785, -122.405], 13);
  const tiles = name => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`;
  L.tileLayer(tiles(dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'), { maxZoom: 16, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' }).addTo(map);
  L.tileLayer(tiles(dark ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference'), { maxZoom: 16 }).addTo(map);
  cluster = L.markerClusterGroup({ maxClusterRadius: 38, showCoverageOnHover: false });
  map.addLayer(cluster);
  map.on('moveend', renderSide);
  return true;
}
function renderMap(list) {
  if (!initMap()) return;
  cluster.clearLayers(); markers = {};
  for (const d of list) {
    if (!d.ll) continue;
    const icon = L.divIcon({ className: '', html: `<div class="mk" style="width:16px;height:16px;background:${colorOf(d)}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    const marker = L.marker(d.ll, { icon, title: d.t, alt: d.t }).bindPopup(`<div class="pop"><div class="t">${esc(d.t)}</div><div class="m">${esc(when(d))}${d.h ? ` · ${esc(d.h)}` : ''}</div><div class="m">${esc(place(d))}</div><div>${links(d)}<a href="${directions(d)}" target="_blank" rel="noopener">Directions</a></div></div>`, { maxWidth: 300 });
    marker.on('click', () => { state.sel = d.i; renderSide(); });
    markers[d.i] = marker; cluster.addLayer(marker);
  }
  setTimeout(() => { map.invalidateSize(); renderSide(); }, 0);
}
function renderSide() {
  if (!map) return;
  const bounds = map.getBounds(), list = filtered().filter(d => d.ll && bounds.contains(d.ll));
  $('asideh').textContent = `${list.length} in view · by start time`;
  $('side').innerHTML = list.map(d => `<button type="button" class="card${state.sel === d.i ? ' sel' : ''}" data-i="${d.i}">
    <div class="t"><span class="dot" style="margin-right:6px;background:${colorOf(d)}"></span>${esc(d.t)}</div>
    <div class="m">${esc(when(d))}${d.n ? ` · ${esc(d.n)}` : ''}</div><div class="m">${esc(place(d))}</div></button>`).join('') || '<p class="empty">No events in this part of the map. Zoom out or change filters.</p>';
  $('side').querySelectorAll('.card').forEach(card => card.onclick = () => focusMarker(+card.dataset.i));
}
function focusMarker(i) {
  const marker = markers[i];
  if (!marker) return;
  state.sel = i;
  cluster.zoomToShowLayer(marker, () => marker.openPopup());
  renderSide();
}

// List
let sortKey = 'sh', sortDir = 1;
function renderList(list) {
  const rows = [...list].sort((a, b) => { const x = a[sortKey] ?? '', y = b[sortKey] ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * sortDir || a.sh - b.sh; });
  const th = (k, label) => `<th aria-sort="${sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-k="${k}">${label}${sortKey === k ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  $('list').innerHTML = rows.length ? `<table><thead><tr>${th('sh', 'Time')}${th('t', 'Event')}${th('h', 'Host')}${th('a', 'Address')}${th('c', 'Location')}<th class="plain">Links</th></tr></thead><tbody>
    ${rows.map(d => `<tr><td class="tm">${esc(when(d))}</td><td class="ev">${esc(d.t)}</td><td>${esc(d.h)}</td><td>${esc(place(d) || d.n || '')}</td>
      <td><span class="tag ${d.c}">${CAT[d.c]}</span></td><td>${links(d)}${d.c === 'public' ? `<a href="${directions(d)}" target="_blank" rel="noopener">Directions</a>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">No events match these filters.</p>';
  $('list').querySelectorAll('th button').forEach(button => button.onclick = () => {
    const k = button.dataset.k; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderList(filtered());
  });
}

// Detail sheet
let lastFocus;
function openDetail(i) {
  state.sel = i; lastFocus = document.activeElement;
  const d = DATA[i];
  $('dbody').innerHTML = `<div class="t">${esc(d.t)}</div>
    <div class="m">${esc(when(d))}${d.e ? '' : ' · end time not listed'}</div>
    ${d.h ? `<div class="m">${esc(d.h)}</div>` : ''}
    <div class="m">${d.c === 'public' ? esc(place(d)) : `<i>${CAT[d.c]}${d.a ? `: ${esc(d.a)}` : ''}</i>`}</div>
    <div class="links">${d.u ? `<a href="${esc(d.u)}" target="_blank" rel="noopener">Open on Partiful</a>` : ''}${d.w ? `<a href="${esc(d.w)}" target="_blank" rel="noopener">Tech Week page</a>` : ''}${d.ll ? '<a href="#" id="onmap">Show on map</a>' : ''}${d.c === 'public' ? `<a href="${directions(d)}" target="_blank" rel="noopener">Directions</a>` : ''}</div>`;
  $('detail').hidden = false;
  $('detail').querySelector('.x').focus();
  const onMap = $('onmap');
  if (onMap) onMap.onclick = event => { event.preventDefault(); closeDetail(false); setView('mapv'); setTimeout(() => focusMarker(i), 50); };
  $('cal').querySelectorAll('.row').forEach(row => row.classList.toggle('sel', +row.dataset.i === i));
}
function closeDetail(restoreFocus = true) {
  $('detail').hidden = true;
  if (restoreFocus && lastFocus?.isConnected) lastFocus.focus();
}
$('detail').querySelector('.x').onclick = () => closeDetail();

// Wiring
function render() {
  const list = filtered();
  const withAddress = list.filter(d => d.c === 'public').length;
  $('count').textContent = `${list.length} shown${state.showHidden ? ` · ${withAddress} with an address` : ''}`;
  if (state.view === 'cal') renderCal(list);
  if (state.view === 'mapv') renderMap(list);
  if (state.view === 'list') renderList(list);
}
function setView(view) {
  state.view = view; save();
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('on', section.id === view));
  document.querySelectorAll('#tabs button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.v === view)));
  render();
}
document.querySelectorAll('#tabs button').forEach(button => button.onclick = () => setView(button.dataset.v));
const syncTod = () => document.querySelectorAll('#tod button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.t === state.tod)));
document.querySelectorAll('#tod button').forEach(button => button.onclick = () => { state.tod = button.dataset.t; save(); syncTod(); render(); });
$('showHidden').checked = state.showHidden;
$('openOnly').checked = state.openOnly;
$('showHidden').onchange = event => { state.showHidden = event.target.checked; save(); render(); };
$('openOnly').onchange = event => { state.openOnly = event.target.checked; save(); render(); };
let typing;
$('q').oninput = event => { clearTimeout(typing); typing = setTimeout(() => { state.q = event.target.value; render(); }, 120); };
addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('detail').hidden) closeDetail();
  if (event.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { event.preventDefault(); $('q').focus(); }
});
let resizing;
addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(render, 150); });
// Move only the now line each minute so scroll position and focus stay put.
setInterval(() => {
  const line = $('cal').querySelector('.nowline');
  if (!line) return;
  line.style.left = `${(Math.min(H1, hourOf(Date.now())) - H0) / (H1 - H0) * 100}%`;
  line.firstChild.textContent = `now ${t(Date.now())}`;
}, 60000);
syncTod();
setView(['cal', 'mapv', 'list'].includes(state.view) ? state.view : 'cal');
