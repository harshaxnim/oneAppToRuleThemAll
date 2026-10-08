import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppInfo } from '../lib/app-info.js';
import { resolveCatalogueApps, parsePublishedCatalogue, publicAppInfo } from '../lib/catalogue.js';
import { HOSTED_APPS } from '../config/catalogue-apps.js';
import { validateCatalogue, createCatalogueRegistrar } from '../scripts/register-catalogue.js';
import { firebaseConfig } from '../config/firebase-config.js';
test('template registers hosted apps; copied repositories register their own root instead of copying the Learning Tracker identity', () => {
  const primary = resolveAppInfo({ repository: 'harshaxnim/websiteSetup' });
  const apps = resolveCatalogueApps(primary, HOSTED_APPS);
  assert.equal(apps.length, 2); assert.equal(apps[0].appId, 'learning-tracker');
  assert.equal(apps[0].url, 'https://harshaxnim.github.io/websiteSetup/learning-tracker/');
  assert.equal(apps[1].appId, 'sf-tech-week-oct-8');
  assert.equal(apps[1].url, 'https://harshaxnim.github.io/websiteSetup/apps/sf-tech-week-oct-8/');
  assert.equal(apps[1].iconUrl, 'https://harshaxnim.github.io/websiteSetup/apps/sf-tech-week-oct-8/icon.svg');
  const newApp = resolveAppInfo({ repository: 'harshaxnim/new-app' });
  assert.deepEqual(resolveCatalogueApps(newApp, HOSTED_APPS), [newApp]);
  assert.throws(() => resolveCatalogueApps(primary, [{ path: '../escape/', appId: 'escape', details: {} }]), /relative directory/);
});
test('only validated public metadata crosses setup; owners are derived from authentication, not manifests', () => {
  const app = resolveAppInfo({ repository: 'harshaxnim/new-app' });
  const payload = { schemaVersion: 1, repository: app.repository, template: app.template, apps: [{ ...app, ownerUid: 'must-not-be-used', privateNotes: 'must-not-be-published' }] };
  assert.deepEqual(validateCatalogue(payload, 'harshaxnim'), [app]);
  assert.equal(publicAppInfo(payload.apps[0]).ownerUid, undefined);
  assert.throws(() => validateCatalogue(payload, 'another-owner'), /belonging to this publisher/);
  payload.apps[0].url = 'javascript:alert(1)';
  assert.throws(() => parsePublishedCatalogue(payload, app.repository));
});
test('missing publisher auth and invalid metadata fail before any network write', async () => {
  let requests = 0;
  const registrar = createCatalogueRegistrar({ config: firebaseConfig, fetcher: () => { requests++; throw new Error('Unexpected request'); } });
  const app = resolveAppInfo({ repository: 'harshaxnim/new-app' });
  const payload = { schemaVersion: 1, repository: app.repository, template: app.template, apps: [app] };
  await assert.rejects(() => registrar.register(payload), /authentication is missing/);
  payload.apps[0].themeColor = 'unsafe';
  await assert.rejects(() => registrar.register(payload, { refreshToken: 'test-only' }));
  assert.equal(requests, 0);
});
