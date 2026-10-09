import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveAppInfo, validateAppRecord, TEMPLATE_REPOSITORY } from './lib/app-info.js';
import { resolveCatalogueApps } from './lib/catalogue.js';
import { HOSTED_APPS } from './config/catalogue-apps.js';
import { APP_ID, APP_DETAILS } from './config/app-config.js';
import { APP_ID as TRACKER_ID, APP_DETAILS as TRACKER_DETAILS } from './learning-tracker/config.js';

// Relative assets work at both / and GitHub Pages repository subpaths.
function repositoryIdentity() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error('Set GITHUB_REPOSITORY=owner/repository for a checkout without a GitHub origin.');
  return match[1];
}
const repository = repositoryIdentity();
const [owner, repo] = repository.split('/');
const manifest = resolveAppInfo({ repository, override: APP_ID, details: APP_DETAILS, hostname: `${owner}.github.io`, pathname: `/${repo}/` });
validateAppRecord(manifest);
const trackerUrl = new URL('learning-tracker/', manifest.url).href;
const trackerManifest = resolveAppInfo({ repository, override: TRACKER_ID, details: { ...TRACKER_DETAILS, url: trackerUrl, iconUrl: new URL('icon.svg', trackerUrl).href } });
validateAppRecord(trackerManifest);
const catalogue = { schemaVersion: 1, repository, template: TEMPLATE_REPOSITORY, apps: resolveCatalogueApps(manifest, HOSTED_APPS) };
// Installable apps get a scoped service worker for offline launches.
const OFFLINE_APPS = [
  { name: 'learning-tracker', path: 'learning-tracker/', publicDir: 'public/learning-tracker/' },
  { name: 'blockplan', path: 'apps/blockplan/', publicDir: 'public/apps/blockplan/' },
];
const SHELL_FILES = ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
function serviceWorker(app, bundle) {
  const up = '../'.repeat(app.path.split('/').filter(Boolean).length);
  const assets = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name)).map(name => `${up}${name}`);
  assets.push('./', './index.html', ...SHELL_FILES.map(file => `./${file}`));
  const hash = createHash('sha256').update(JSON.stringify(bundle));
  for (const file of SHELL_FILES) hash.update(readFileSync(new URL(`./${app.publicDir}${file}`, import.meta.url)));
  const version = hash.digest('hex').slice(0, 16);
  return `
const PREFIX = '${app.name}:' + new URL('./', self.location).pathname + ':';
const CACHE = PREFIX + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(assets)}.map(path => new URL(path, self.location).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const page = new URL('./', self.location).href;
  if (event.request.mode === 'navigate' && event.request.url.startsWith(page)) {
    event.respondWith(fetch(event.request).then(response => {
      if (!response.ok) throw new Error('Page unavailable');
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(page, copy)));
      return response;
    }).catch(() => caches.match(page)));
  } else if (ASSETS.includes(event.request.url)) {
    // Build files are public and immutable; dev/preview servers may add
    // Vary: Origin even though their same-origin module bytes never differ.
    event.respondWith(caches.match(event.request, { ignoreVary: true }).then(cached => cached || fetch(event.request)));
  }
});
`;
}
export default defineConfig({
  base: './',
  define: { __APP_REPOSITORY__: JSON.stringify(repository) },
  build: { rollupOptions: { input: { directory: 'index.html', tracker: 'learning-tracker/index.html', techWeek: 'apps/sf-tech-week-oct-8/index.html', blockplan: 'apps/blockplan/index.html', notebook: 'examples/notebook/index.html', publisher: 'setup/publisher/index.html' } } },
  plugins: [{
    name: 'app-manifest',
    configureServer(server) {
      server.middlewares.use('/app-catalog.json', (_, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(catalogue));
      });
    },
    generateBundle(_, bundle) {
      this.emitFile({ type: 'asset', fileName: 'app-manifest.json', source: JSON.stringify(manifest, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'app-catalog.json', source: JSON.stringify(catalogue, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'learning-tracker/app-manifest.json', source: JSON.stringify(trackerManifest, null, 2) });
      // Cache only each installable app's shell and build assets. No auth,
      // Firestore, or private API responses enter a service-worker cache.
      for (const app of OFFLINE_APPS) this.emitFile({ type: 'asset', fileName: `${app.path}sw.js`, source: serviceWorker(app, bundle) });
    },
  }],
});
