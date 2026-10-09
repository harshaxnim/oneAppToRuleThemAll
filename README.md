# OneAppToRuleThemAll

A reusable starting point for personal web apps: Google sign-in, private Firestore storage, and GitHub Pages deployment. This repository also hosts the public OneAppToRuleThemAll directory of apps built from the template. Apps inherit the shared **gatewaybsite** Firebase project and public Web configuration. The same Google account has the same Firebase UID across apps; each app has its own data namespace.

**Use this template → create a repository → build your app → `npm run setup:app` → enable Pages → push to `main`.**

The shared platform is configured once by the template owner. Future apps normally need no Firebase setup. See [ONE_TIME_SETUP.md](ONE_TIME_SETUP.md) only when completing or rebuilding that platform.

The app is named **OneAppToRuleThemAll**. The matching GitHub repository rename is pending an owner changing **Settings → General → Repository name** from `websiteSetup` to `OneAppToRuleThemAll`; the cloud integration's rename request returned HTTP 403. Until then, the current repository and Pages URL still use `websiteSetup`. Existing template markers and directory records with `harshaxnim/websiteSetup` remain supported. Renaming the Pages path changes its derived APP_ID; use an explicit stable APP_ID if retaining existing private data is required.

## Start a new app

1. Select **Use this template → Create a new repository**. Agents can also run `gh repo create OWNER/APP --template harshaxnim/OneAppToRuleThemAll --public --clone`.
2. Keep `config/firebase-config.js`, `lib/`, `firestore.rules`, and `.github/workflows/pages.yml`. Do not create a new Firebase project.
3. Customize `index.html`, `app.js`, and `styles.css`, following [DESIGN.md](DESIGN.md) for mobile layouts, typography, and app color. The root site is a public app directory. The notebook starter is in `examples/notebook/` and demonstrates private structured storage, realtime updates, and Google sign-in. Customize or replace the root UI for a new application; keep the shared platform modules.
4. Run `npm run setup:app` after customizing the app metadata. It builds a public app catalogue and creates the Firestore entries through the shared publisher workflow. The command waits for real registration success; missing credentials, conflicting IDs, and other-owner records fail setup. No UID is hardcoded.
5. Ensure **Settings → Pages → Build and deployment → Source → GitHub Actions** is selected. Template files copy; repository settings do not. With a credential that has Pages and Administration write permission, inspect `gh api repos/OWNER/APP/pages` and create only if the response is 404: `gh api --method POST repos/OWNER/APP/pages -f build_type=workflow`. If it exists with a branch-based source, update it to workflow-based deployment. Do not add a PAT secret to each app.
6. Push to `main`. The official Pages Actions build and publish `dist/`. If the repository still has a legacy branch-based Pages source on `main`, the workflow waits for that build to finish before publishing Vite's compiled output. GitHub Actions remains the recommended Pages source. Check the Actions run and visit `https://OWNER.github.io/APP/`.

For agents creating a repo: verify inherited files, build application-specific code, check APP_ID, enable Pages if permitted, push, inspect the deployment, then verify Google sign-in, write/reload, and isolation. A successful push alone does not prove deployment or auth readiness.

## Local development

Use Node 24 (`.nvmrc`), then:

```bash
npm ci
npm run dev
```

Firebase's normal browser auth persistence restores your login. Google sign-in requires `localhost` in Firebase's authorized domains. Use the URL Vite prints; popups must be allowed. Production uses the same committed configuration, with no `.env` file needed.

```bash
npm test                  # APP_ID and configuration validation
npm run check:firebase    # Validate public configuration shape, not live readiness
npm run build            # Static production output in dist/
npm run preview          # Serve the production output locally
```

For emulator integration testing (Java 21+ required):

```bash
npm run test:rules        # Real Firestore emulator: storage operations and access rules
npx playwright install chromium  # Once, if Chromium is not already available
npm run test:browser      # Signed-out UI and mobile layout
npm run test:e2e          # Emulator Google credentials, save/reload, sign-out and user isolation
```

To develop with emulated auth and Firestore instead of the shared project:

```bash
npx firebase emulators:start --only auth,firestore --project demo-personal-apps
# In a second terminal:
VITE_USE_EMULATORS=true npm run dev
```

Emulator mode is development-only and uses a deliberately fictional `demo-personal-apps` project; it cannot be enabled in production output. It never writes to the shared live database. The browser integration test uses the Auth emulator's supported Google credential flow and verifies persistence, sign-out, and isolation through the UI. Production's interactive Google popup still needs separate live verification; its helper scripts require Internet access even for an emulated popup.

## App directory

The root website lists the shared `appDirectory/{appId}` collection. Visitors can search and filter apps by **planned, in development, live, paused, or archived** without signing in. Signed-in users can add an app and manage records they own. The design starts at a 360 px mobile viewport, with accessible filters, forms, readable inputs, and touch-sized controls; `AGENTS.md` requires mobile validation for future apps.

Every directory document contains public metadata only:

```text
appDirectory/{appId}
  ownerUid
  appId, repository, repositoryUrl, template
  name, description, url, status
  iconUrl, themeColor
  createdAt, updatedAt
```

The creator's authenticated UID becomes `ownerUid`. Firestore rules allow public reads, require the creator to set their own UID and matching document `appId`, restrict edits/deletion to that owner, and keep `ownerUid` and `appId` immutable. Rules authorize access; they do not validate the metadata schema or enumerate allowed fields. `lib/app-info.js` validates app names, descriptions, statuses, links, branding, and optional tags before application writes and manifest builds. No owner UID is hardcoded. Private `users/{userId}/apps/...` rules are unchanged. Directory IDs are global across the shared project; use an explicit APP_ID override if another repository has already registered the same ID.

Owners can update repository metadata after a rename while retaining the existing App ID and private-data namespace. Missing creation timestamps are initialized on save; supplied metadata is merged with existing fields rather than replacing the whole record.

New apps are registered during **template copying and site setup**, before visitors sign in. Run `npm run setup:app` once the app name, description, icon, theme, and APP_ID are set. The build emits `app-catalog.json`: generated repositories contain their root app; the central template includes declared hosted apps from `config/catalogue-apps.js`, such as Learning Tracker. Setup dispatches `register-app.yml` in the shared template repository using the existing GitHub connection, waits for its result, and fails unless registration succeeds. The central workflow uses one securely stored `FIREBASE_REFRESH_TOKEN`, identifies its Firebase account, and creates `appDirectory/{appId}` with that account's UID. Repeating setup preserves owner metadata, timestamps, status, and future fields; it rejects conflicting repositories and other-owner records. User sign-in is exclusively for private app data and does not claim catalogue ownership.

The template owner connects publishing once at the deployed `setup/publisher/` page: Google sign-in → Copy publishing credential → store it as `FIREBASE_REFRESH_TOKEN` under the central repository's **Settings → Secrets and variables → Actions**. Never paste the credential into chat or commit it. The public SDK configuration and GitHub token do not authenticate a Firebase user. New apps need no per-app Firebase secret or hardcoded owner UID. A cloud environment may alternatively bind `FIREBASE_REFRESH_TOKEN` securely (or an ephemeral `FIREBASE_ID_TOKEN`); setup then registers directly. Do not use a Firebase CLI OAuth token in place of a Firebase Auth user credential.

The Pages workflow checks every declared app, including apps hosted inside the central template, against Firestore before publishing. A missing record produces a warning, not a failure: the directory shows declared apps from the published `app-catalog.json` as read-only fallback cards until their record exists, and the Firestore record replaces the fallback as soon as it is created. A record owned by another repository, or without an owner, still blocks deployment. For apps hosted inside the central site, add metadata to `config/catalogue-apps.js` and run the same setup command. `npm run check:registration` verifies the live entries without credentials. The websiteSetup catalogue already subscribes to `appDirectory`, so newly created documents appear automatically for all visitors. There is no need for someone to open or sign into the new app first.

**Sync from GitHub** searches the current repository owner's public repos for template ancestry or the inherited `template.json` marker. It adds missing records owned by the signed-in caller. Private repos require manual registration. Existing names and statuses are preserved. A deployed `app-manifest.json` supplies app identity and branding; a successful GET of the actual app page marks a newly discovered app live. GitHub's unauthenticated API may apply rate limits; the UI reports errors and allows manual registration. Discovery is a manual recovery tool. Required setup-time registration supplies new records automatically; it does not depend on this button.

`config/app-config.js` optionally defines `APP_DETAILS` (`name`, `description`, initial `status`, custom `url`, `iconUrl`, `themeColor`, and `tags`) alongside an APP_ID override. Set an HTTPS icon URL and a six-digit hex theme color that match the actual app. Optional tags are an array of at most 20 nonempty strings, each at most 50 characters; these constraints live in application code. By default, the icon is `icon.svg` at the app URL; replace `public/icon.svg` with the app's own icon. Owners can also edit branding in the directory. Saving an app preserves metadata fields not supplied by the form, including existing tags. Older records without branding get a letter icon and the default warm theme. Display code rejects unsafe links and falls back for malformed colors/statuses independently of write validation. Repository identity is supplied automatically by GitHub Actions or the Git origin in local builds. The build emits `app-manifest.json`; keep `template.json` in generated apps so the directory can discover them.

Cards show each app and its description immediately, without a promotional hero or counters. On load, the browser checks actual app pages with GET requests (four at a time, with a ten-second timeout). **Check pages** repeats the checks. Successful responses show Live, failed HTTP responses replace a saved Live badge with Unavailable, and network/CORS failures show Unverified. Paused and archived statuses are retained. Checks are temporary browser observations and do not overwrite Firestore status; filters use the saved lifecycle status. Custom domains must allow cross-origin requests for the directory to verify them. An opaque `no-cors` response never counts as proof that an app is live.

```js
import { getAppRegistry, appInfo } from './lib/platform.js';
const directory = getAppRegistry();
const stop = directory.subscribeApps(records => render(records), console.error);
await directory.registerApp(appInfo); // first creation owns the record; repeats preserve it
await directory.setStatus(appInfo.appId, 'paused'); // owner only
stop();
```

The collection is created in Firestore when its first real document is saved; Firestore has no empty-folder objects. The owner has published the authorization-focused directory rules. Adding or changing metadata fields requires application validation changes, with no normal rules redeployment. This collection contains public metadata; keep all private application documents under the separate user namespace.

## Application identity

`lib/app-id.js` resolves APP_ID in this order:

1. `APP_ID` in `config/app-config.js`, if supplied.
2. The first path segment on a `*.github.io` host: `/videos/` → `videos`, `/research-tool/` → `research-tool`. Nested routes retain the repository identity. An account root site uses the host itself.
3. `local-app` for localhost and other hosts.

Set `export const APP_ID = 'stable-name';` for custom domains or a durable namespace after a repo rename. Use a unique override while developing multiple apps on localhost if their local data must stay separate. App IDs are 1–128 letters, digits, dots, underscores, or hyphens and start with a letter or digit. Changing APP_ID selects a different namespace; it does not migrate data.

## Shared platform API

Application code imports from `lib/platform.js`; Firebase setup stays in `lib/`.

```js
import {
  appId, signIn, signOut, getCurrentUser, onUserChanged,
  loadState, saveState, getStorage,
} from './lib/platform.js';

await signIn(); // Google popup; returns the Firebase User
getCurrentUser(); // null or User with uid, displayName, email, photoURL
const stopAuth = onUserChanged(async user => {
  if (!user) return;
  const state = await loadState({ count: 0 });
  await saveState({ ...state, count: state.count + 1 });
});
await signOut();
stopAuth();
```

Wait for `onUserChanged` before storage requests on startup so Firebase can restore the session. State is stored at `users/{uid}/apps/{appId}/data/state`. Saving replaces the state's value, which can be an object, array, or scalar. Missing state returns an independent clone of your default.

For richer apps, use relative document and collection paths:

```js
const store = getStorage();
await store.setDocument('projects/project-1', { title: 'Research' });
await store.setDocument('projects/project-1', { archived: false }, { merge: true });
const project = await store.getDocument('projects/project-1'); // data or null
const id = await store.addDocument('projects/project-1/notes', { text: 'An idea' });
const rows = await store.getCollection('projects/project-1/notes'); // [{ id, data }]
await store.deleteDocument(`projects/project-1/notes/${id}`);
const stop = store.subscribeCollection('projects', rows => render(rows), console.error);
stop();
```

`getCollection` and `subscribeCollection` accept `{ where: [['status', '==', 'open']], orderBy: [['createdAt', 'desc']], limit: 50 }`. Firestore may require composite indexes for compound queries; indexes are shared infrastructure and may be added as an app grows. `subscribeDocument` provides realtime document data or null. All subscriptions return an unsubscribe function: unsubscribe and clear user-visible data on sign-out/user change (as `app.js` does).

`store.transaction(async tx => { const old = await tx.get('data/counter'); tx.set('data/counter', { count: (old?.count ?? 0) + 1 }); })` supports atomic scoped updates. Read all transaction documents before writing. Firebase can retry callbacks, so avoid external side effects inside them.

The library scopes every operation to `users/{currentUid}/apps/{appId}` and rejects unauthenticated access, invalid path parity, and traversal. Document paths have an even number of segments; collection paths have an odd number. SDK errors propagate to callers; handle them in the application. The state API follows last-write-wins semantics; use transactions or document-based data when concurrent edits matter.

## Security and scope

The committed Firebase Web settings are public, not server credentials. Firestore rules enforce `request.auth.uid == userId` for each app root and all descendants, and deny paths outside that hierarchy. Arbitrary new app IDs and nested data need no new rules.

This is a shared personal platform: namespaces separate normal application operations, but apps signed in as the same UID are trusted to access that user's other app namespaces. APP_ID is not an independent security credential. Do not host untrusted applications on this shared platform. Different sharing models may need different rules later. Firebase quotas and billing also belong to the shared project.

## Verify deployment

After a successful Pages Actions run, check the exact repository URL, verify the APP_ID in `app-manifest.json`, confirm the public directory loads without signing in, then add an app, change its status, and reload. A second account must not get edit controls for the first owner’s record. In `examples/notebook/`, sign in, save a note, reload, and confirm it returns. Sign out and ensure notes disappear; a second Google account must have an independent notebook. A different app path must use a different namespace. Google sign-in runs separately on each origin even though the shared project gives the same account the same UID.

The old Flask/nginx code is preserved on [`legacy/flask-nginx`](https://github.com/harshaxnim/OneAppToRuleThemAll/tree/legacy/flask-nginx).

## Learning Tracker

The site also hosts a complete [Learning Tracker](learning-tracker/README.md) at `learning-tracker/`, with its own branding and stable private namespace. It supports links and notes, touch/keyboard reordering, search, completion filters, JSON backups, optional Google sync, and offline home-screen installation. The root remains the public app catalogue. Run `npm run test:offline` after building to verify the compiled PWA at the Pages subpath.

Run `npm run test:setup` to verify the setup command’s Firebase REST authentication, actual Firestore creation, metadata preservation, other-owner denial, and private-data isolation against the Auth/Firestore emulators.

In cloud environments with an HTTPS proxy, use Node 24’s supported `NODE_USE_ENV_PROXY=1` and `NODE_USE_SYSTEM_CA=1` settings for setup and registration checks. These use the configured proxy and system trust store without disabling TLS verification.
