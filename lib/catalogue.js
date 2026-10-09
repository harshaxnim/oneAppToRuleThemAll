import { isTemplateRepository, resolveAppInfo, validateAppRecord } from './app-info.js';
const PUBLIC_FIELDS = ['appId', 'repository', 'repositoryUrl', 'template', 'name', 'description', 'status', 'url', 'iconUrl', 'themeColor', 'tags'];
export function publicAppInfo(record) {
  const info = Object.fromEntries(PUBLIC_FIELDS.filter(key => record?.[key] !== undefined).map(key => [key, record[key]]));
  validateAppRecord(info);
  return info;
}
export function resolveCatalogueApps(primary, hosted = []) {
  const template = isTemplateRepository(primary.repository);
  const apps = template ? [] : [publicAppInfo(primary)];
  for (const child of hosted) {
    if (child.templateOnly && !template) continue;
    if (typeof child.path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\/$/.test(child.path) || child.path.split('/').some(part => part === '.' || part === '..')) throw new Error('Hosted apps need a relative directory path.');
    const url = new URL(child.path, primary.url).href;
    apps.push(publicAppInfo(resolveAppInfo({ repository: primary.repository, override: child.appId, details: { ...child.details, url, iconUrl: child.details.iconUrl ?? new URL('icon.svg', url).href } })));
  }
  if (new Set(apps.map(app => app.appId)).size !== apps.length) throw new Error('Every hosted app needs a unique APP_ID.');
  return apps;
}
export function parsePublishedCatalogue(payload, repository) {
  if (payload?.schemaVersion !== 1 || payload.repository !== repository || !isTemplateRepository(payload.template) || !Array.isArray(payload.apps) || payload.apps.length > 50) throw new Error('Invalid published app catalogue.');
  const apps = payload.apps.map(publicAppInfo);
  if (apps.some(app => app.repository !== repository) || new Set(apps.map(app => app.appId)).size !== apps.length) throw new Error('Published apps must belong to their repository and have unique IDs.');
  return apps;
}
// Directory cards: Firestore records are the source of truth. Apps declared
// in this repository's catalogue appear as read-only fallback cards until
// their record exists, so a missing registration never hides a hosted app.
export function mergeDirectory(records = [], fallback = []) {
  const registered = new Set(records.map(record => record.appId ?? record.id));
  return [...records, ...fallback.filter(app => !registered.has(app.appId)).map(app => ({ ...app, fallback: true }))];
}
