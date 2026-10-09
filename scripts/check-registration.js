import { readCatalogue } from './register-catalogue.js';
import { firebaseConfig } from '../config/firebase-config.js';
// A missing record is a warning: the directory shows declared apps from the
// published catalogue until their Firestore record exists. A record owned by
// another repository, or without an owner, still fails the deploy.
const warn = text => console.log(process.env.GITHUB_ACTIONS ? `::warning title=App not registered::${text}` : `Warning: ${text}`);
async function main() {
  const catalogue = await readCatalogue();
  for (const app of catalogue.apps) {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/appDirectory/${encodeURIComponent(app.appId)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (response.status === 404) {
      warn(`appDirectory/${app.appId} is missing. The directory shows it from app-catalog.json until npm run setup:app creates the record.`);
      continue;
    }
    if (!response.ok) throw new Error(`Could not verify app registration (HTTP ${response.status}).`);
    const document = await response.json();
    if (document.fields?.appId?.stringValue !== app.appId || document.fields?.repository?.stringValue !== app.repository || !document.fields?.ownerUid?.stringValue) throw new Error(`App ${app.appId} has conflicting or incomplete catalogue ownership. Setup must resolve this before deployment.`);
    console.log(`Verified appDirectory/${app.appId}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
