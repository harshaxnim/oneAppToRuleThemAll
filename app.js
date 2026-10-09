import { signIn, signOut, onUserChanged, getAppRegistry, appInfo } from './lib/platform.js';
import { APP_STATUSES, resolveAppInfo, TEMPLATE_REPOSITORY } from './lib/app-info.js';
import { discoverTemplateApps } from './lib/github-discovery.js';
import { checkAppPage } from './lib/page-status.js';
import { mergeDirectory, parsePublishedCatalogue } from './lib/catalogue.js';

const $ = id => document.getElementById(id);
const labels = { planning: 'Planned', development: 'In development', live: 'Live', paused: 'Paused', archived: 'Archived' };
let user = null;
let apps = [];
let records = [];
let declared = [];
let loaded = false;
let filter = 'all';
let editing = false;
let generation = 0;
let registry;
const pageChecks = new Map();
let checkQueue = [];
let runningChecks = 0;

function updatePageBadges(url, result) {
  for (const card of document.querySelectorAll('.app-card')) {
    if (card.dataset.url !== url) continue;
    const badge = card.querySelector('.status-badge');
    const savedStatus = card.dataset.status;
    const status = ['paused', 'archived'].includes(savedStatus) ? savedStatus : result.state === 'reachable' ? 'live' : savedStatus === 'live' ? (result.state === 'unavailable' ? 'unavailable' : 'unverified') : savedStatus;
    badge.className = `status-badge status-${status}`;
    badge.textContent = labels[status] || (status === 'unavailable' ? 'Unavailable' : 'Unverified');
    const detail = card.querySelector('.page-result');
    detail.textContent = result.state === 'reachable' ? 'Page is reachable' : result.state === 'unavailable' ? `Page returned HTTP ${result.status}` : 'Couldn’t verify page';
    detail.title = result.reason || 'Checked from this browser';
  }
}
function pumpPageChecks() {
  $('check-pages').disabled = runningChecks > 0 || checkQueue.length > 0;
  $('check-pages').textContent = $('check-pages').disabled ? 'Checking pages…' : 'Check pages ↻';
  while (runningChecks < 4 && checkQueue.length) {
    const url = checkQueue.shift(); runningChecks++;
    checkAppPage(url).then(result => { pageChecks.set(url, result); updatePageBadges(url, result); }).finally(() => { runningChecks--; pumpPageChecks(); });
  }
}
function schedulePageChecks() {
  for (const app of apps) {
    if (pageChecks.has(app.url) || app.status === 'archived') continue;
    pageChecks.set(app.url, { state: 'checking' }); checkQueue.push(app.url);
  }
  pumpPageChecks();
}

function message(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`); svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg;
}
function link(text, url, className = '') {
  if (typeof url !== 'string') return null;
  const anchor = document.createElement('a'); anchor.textContent = text; anchor.className = className;
  try { const target = new URL(url); if (target.protocol !== 'https:' || target.username || target.password) return null; }
  catch { return null; }
  anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor;
}
function empty(title, text) {
  const container = document.createElement('div'); container.className = 'empty-state';
  const mark = document.createElement('div'); mark.className = 'empty-mark'; mark.append(icon('grid'));
  const heading = document.createElement('h3'); heading.textContent = title;
  const description = document.createElement('p'); description.textContent = text;
  container.append(mark, heading, description); return container;
}
function render() {
  const needle = $('search-apps').value.trim().toLowerCase();
  const visible = apps.filter(app => (filter === 'all' || app.status === filter)
    && [app.name, app.description, app.repository].some(value => String(value || '').toLowerCase().includes(needle)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  $('app-list').replaceChildren();
  $('app-list').setAttribute('aria-busy', String(!loaded));
  if (!visible.length) {
    const node = empty(loaded ? (apps.length ? 'No apps match this view.' : 'Your next idea belongs here.') : 'Opening the directory…',
      loaded ? (apps.length ? 'Try another search or status to find what you’re looking for.' : 'Apps built from the template will appear here. Sign in to add an app or discover them from GitHub.') : 'Gathering the latest apps and updates.');
    if (loaded && !apps.length && user) {
      const add = document.createElement('button'); add.className = 'button button-primary'; add.textContent = 'Add your first app'; add.addEventListener('click', () => openForm()); node.append(add);
    }
    $('app-list').append(node); return;
  }
  for (const app of visible) {
    const status = APP_STATUSES.includes(app.status) ? app.status : 'planning';
    const card = document.createElement('article'); card.className = 'app-card'; card.dataset.url = app.url; card.dataset.status = status;
    const theme = typeof app.themeColor === 'string' && /^#[A-Fa-f0-9]{6}$/.test(app.themeColor) ? app.themeColor : '#b97053';
    card.style.setProperty('--app-theme', theme); card.style.setProperty('--app-tint', `${theme}12`);
    const top = document.createElement('div'); top.className = 'card-top';
    const mark = document.createElement('div'); mark.className = 'app-icon'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = String(app.name || '?').slice(0, 1).toUpperCase();
    if (app.iconUrl && link('', app.iconUrl)) {
      const image = document.createElement('img'); image.src = app.iconUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove()); mark.append(image);
    }
    const badge = document.createElement('span'); badge.className = `status-badge status-${status}`; badge.textContent = status === 'live' ? 'Checking…' : labels[status]; top.append(mark, badge);
    const title = document.createElement('h3'); title.textContent = app.name || 'Untitled app';
    const description = document.createElement('p'); description.className = 'app-description'; description.textContent = app.description || 'A new idea built on the shared platform.';
    const meta = document.createElement('div'); meta.className = 'card-meta'; meta.append(icon('code'));
    const repo = link(app.repository, app.repositoryUrl); if (repo) meta.append(repo);
    const bottom = document.createElement('div'); bottom.className = 'card-bottom';
    const date = document.createElement('span'); date.className = 'card-date';
    const updated = typeof app.updatedAt?.toDate === 'function' ? app.updatedAt.toDate() : null; date.textContent = updated ? `Updated ${updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : app.fallback ? 'Hosted on this site' : 'New to the ecosystem';
    const pageResult = document.createElement('span'); pageResult.className = 'page-result'; pageResult.textContent = app.status === 'archived' ? 'Archived' : 'Checking page…';
    const actions = document.createElement('div'); actions.className = 'card-actions';
    if (!app.fallback && user?.uid === app.ownerUid) {
      const edit = document.createElement('button'); edit.className = 'manage-button'; edit.type = 'button'; edit.textContent = 'Manage'; edit.setAttribute('aria-label', `Manage ${app.name}`); edit.addEventListener('click', () => openForm(app)); actions.append(edit);
    }
    const visit = link('Open app', app.url, 'app-link'); if (visit) { visit.append(icon('arrow')); actions.append(visit); }
    const info = document.createElement('div'); info.className = 'card-info'; info.append(pageResult, date); bottom.append(info, actions); card.append(top, title, description, meta, bottom); $('app-list').append(card);
    const result = pageChecks.get(app.url); if (result && result.state !== 'checking') updatePageBadges(app.url, result);
  }
}
function openForm(app) {
  if (!user) return;
  editing = !!app; $('app-form').reset(); $('form-error').hidden = true;
  $('dialog-title').textContent = editing ? 'Manage app' : 'Add an app';
  for (const [field, key] of [['repository', 'repository'], ['id', 'appId'], ['name', 'name'], ['description', 'description'], ['url', 'url'], ['status', 'status'], ['icon', 'iconUrl'], ['theme', 'themeColor']]) {
    $(`app-${field}`).value = app?.[key] || (field === 'status' ? 'development' : field === 'theme' ? '#b97053' : '');
  }
  $('app-repository').readOnly = false; $('app-id').readOnly = editing;
  $('app-dialog').showModal();
}
function closeForm() { $('app-dialog').close(); }
$('add-app').addEventListener('click', () => openForm());
$('close-dialog').addEventListener('click', closeForm); $('cancel-dialog').addEventListener('click', closeForm);
$('app-repository').addEventListener('change', () => {
  if (editing) return;
  try {
    const info = resolveAppInfo({ repository: $('app-repository').value.trim() });
    for (const [field, key] of [['id', 'appId'], ['name', 'name'], ['url', 'url'], ['icon', 'iconUrl']]) { if (!$(`app-${field}`).value) $(`app-${field}`).value = info[key]; }
  } catch { /* Form submission reports invalid repository input. */ }
});
$('app-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!user) return;
  const currentGeneration = generation;
  $('save-app').disabled = true; $('form-error').hidden = true;
  try {
    const repository = $('app-repository').value.trim();
    await registry.saveApp({
      appId: $('app-id').value.trim(), name: $('app-name').value.trim(), repository,
      description: $('app-description').value.trim(), status: $('app-status').value, iconUrl: $('app-icon').value.trim(), themeColor: $('app-theme').value,
      url: $('app-url').value.trim(), repositoryUrl: `https://github.com/${repository}`, template: TEMPLATE_REPOSITORY,
    });
    if (generation === currentGeneration) { closeForm(); message(editing ? 'App details updated.' : 'Your app is part of the ecosystem.'); }
  } catch (error) {
    if (generation === currentGeneration) { $('form-error').textContent = error.code === 'permission-denied' ? 'You don’t have permission to update this app.' : error.message; $('form-error').hidden = false; }
  } finally { $('save-app').disabled = false; }
});
$('filters').addEventListener('click', event => {
  const selected = event.target.closest('[data-status]'); if (!selected) return;
  filter = selected.dataset.status;
  for (const button of $('filters').querySelectorAll('button')) { button.classList.toggle('active', button === selected); button.setAttribute('aria-pressed', String(button === selected)); }
  render();
});
$('search-apps').addEventListener('input', render);
$('check-pages').addEventListener('click', () => {
  if (runningChecks || checkQueue.length) return;
  pageChecks.clear(); schedulePageChecks(); render();
});
$('auth-button').addEventListener('click', async () => {
  $('auth-button').disabled = true; message();
  try { if (user) await signOut(); else await signIn(); }
  catch (error) { if (error.code !== 'auth/popup-closed-by-user') message(error.code === 'auth/popup-blocked' ? 'Allow the sign-in popup and try again.' : 'Sign-in could not be completed. Please try again.'); }
  finally { $('auth-button').disabled = false; }
});
$('sync-github').addEventListener('click', async () => {
  if (!user) return;
  const currentGeneration = generation;
  $('sync-github').disabled = true; message('Looking for apps built from the template…');
  try {
    const discovered = await discoverTemplateApps({ owner: appInfo.repository.split('/')[0], onProgress: text => { if (generation === currentGeneration) message(text); } });
    let created = 0;
    for (const info of discovered) {
      if (generation !== currentGeneration) return;
      if ((await registry.registerApp(info)).created) created++;
    }
    if (generation === currentGeneration) message(`Found ${discovered.length} template apps. Added ${created} new ${created === 1 ? 'app' : 'apps'}; existing app statuses were preserved.`);
  } catch (error) { if (generation === currentGeneration) message(error.message); }
  finally { $('sync-github').disabled = false; }
});

function refresh() { apps = mergeDirectory(records, declared); schedulePageChecks(); render(); }
// Apps declared in this repository show even before (or without) their
// Firestore record, so the directory never hides an app this site hosts.
fetch('./app-catalog.json').then(response => response.ok ? response.json() : null).then(payload => {
  if (!payload) return;
  declared = parsePublishedCatalogue(payload, appInfo.repository);
  if (loaded) refresh();
}).catch(error => console.warn('Declared app catalogue unavailable:', error.message));
try {
  registry = getAppRegistry();
  registry.subscribeApps(rows => { records = rows; loaded = true; refresh(); }, error => {
    console.error('Directory read failed:', error.code || error.message);
    if (declared.length) { loaded = true; refresh(); message('Showing the apps hosted on this site. The full directory couldn’t load right now.'); return; }
    $('app-list').setAttribute('aria-busy', 'false');
    $('app-list').replaceChildren(empty('The directory is taking a moment.', 'We couldn’t load the latest apps. Please try again soon.'));
  });
  $('auth-button').disabled = true;
  onUserChanged(currentUser => {
    generation++; user = currentUser;
    $('auth-button').disabled = false;
    $('auth-button').textContent = user ? 'Sign out' : 'Sign in ↗';
    $('auth-button').setAttribute('aria-label', user ? 'Sign out' : 'Sign in with Google');
    $('user-name').textContent = user?.displayName || '';
    $('add-app').hidden = !user; $('sync-github').hidden = !user;
    if (!user) closeForm();
    if (loaded) render();
  }, () => message('Sign-in is temporarily unavailable. You can still explore the apps.'));
} catch (error) {
  console.error(error);
  message('The shared platform is temporarily unavailable. Please try again soon.');
  $('auth-button').disabled = true;
}
