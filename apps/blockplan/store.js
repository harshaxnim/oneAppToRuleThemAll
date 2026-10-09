import { validateState, seedState, dateKey, SCHEMA_VERSION } from './model.js';
// Same contract as Learning Tracker: every change lands on this device first;
// signed-in plans then sync to the account's private namespace. Guest and
// account copies are cached under separate keys.
const PREFIX = 'blockplan:v1:';
export class PlanStore {
  constructor(platform, onChange) {
    this.platform = platform;
    this.onChange = onChange;
    this.state = null;
    this.uid = null;
    this.ready = false;
    this.generation = 0;
    this.version = 0;
    this.pending = Promise.resolve();
    this.status = '';
    this.error = false;
  }
  key(uid = this.uid) { return PREFIX + (uid ? `user:${uid}` : 'guest'); }
  readCache(uid) {
    const raw = localStorage.getItem(this.key(uid));
    if (raw === null) return null;
    const record = JSON.parse(raw);
    return { state: validateState(record.state), dirty: record.dirty === true };
  }
  writeCache(dirty) {
    try {
      localStorage.setItem(this.key(), JSON.stringify({ state: this.state, dirty }));
      return true;
    } catch {
      this.setStatus('Device storage is unavailable. Export your plan before closing.', true);
      return false;
    }
  }
  setStatus(message, error = false) {
    this.status = message;
    this.error = error;
    this.onChange(this);
  }
  guestStatus() { return navigator.onLine ? 'Saved on this device' : 'Offline · Saved on this device'; }
  async switchUser(user) {
    const generation = ++this.generation;
    this.uid = user?.uid ?? null;
    this.ready = false;
    this.setStatus(this.uid ? 'Opening your plan…' : 'Opening this device’s plan…');
    let cached;
    try { cached = this.readCache(this.uid); } catch {
      this.setStatus('The saved plan could not be opened. Import a backup to recover it.', true);
      return;
    }
    if (!this.uid) {
      this.state = cached?.state ?? seedState(dateKey(new Date()));
      this.ready = true;
      if (this.writeCache(false)) this.setStatus(this.guestStatus());
      return;
    }
    if (!navigator.onLine) {
      if (cached) {
        this.state = cached.state;
        this.ready = true;
        this.setStatus('Offline · Changes stay on this device until you reconnect');
      } else this.setStatus('Go online once to open this account’s plan.', true);
      return;
    }
    try {
      // An existing account plan wins over the device's guest plan; creation is
      // transactional so two first visits cannot overwrite each other.
      let guest;
      try { guest = this.readCache(null)?.state; } catch { /* Fall back to the sample plan. */ }
      guest ??= seedState(dateKey(new Date()));
      const state = await this.platform.getStorage().transaction(async tx => {
        const document = await tx.get('data/state');
        if (document) return validateState(document.value);
        tx.set('data/state', { value: guest });
        return guest;
      });
      if (generation !== this.generation) return;
      this.state = cached?.dirty ? cached.state : state;
      this.ready = true;
      if (!this.writeCache(cached?.dirty ?? false)) return;
      if (cached?.dirty) this.sync();
      else this.setStatus('Synced');
    } catch {
      if (generation !== this.generation) return;
      if (cached) {
        this.state = cached.state;
        this.ready = true;
      }
      this.setStatus(cached ? 'Sync unavailable · Your device copy is safe' : 'Could not open your plan. Reconnect or sign out to use this device.', true);
    }
  }
  replace(state) {
    if (!this.ready) throw new Error('Wait for your plan to open before making changes.');
    this.state = { ...validateState(state), schemaVersion: SCHEMA_VERSION };
    this.version++;
    const saved = this.writeCache(Boolean(this.uid));
    if (this.uid) this.sync(saved);
    else if (saved) this.setStatus(this.guestStatus());
  }
  sync(locallySaved = true) {
    if (!this.uid || !this.ready) return;
    if (!navigator.onLine) {
      if (locallySaved) this.setStatus('Offline · Will sync when reconnected');
      return;
    }
    const { uid, generation, version } = this;
    const state = structuredClone(this.state);
    if (locallySaved) this.setStatus('Syncing…');
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (uid !== this.uid || generation !== this.generation) return;
      try {
        await this.platform.getStorage().saveState(state);
        if (generation !== this.generation || version !== this.version) return;
        if (this.writeCache(false)) this.setStatus('Synced');
        else this.setStatus('Synced · Device storage unavailable', true);
      } catch {
        if (generation !== this.generation || version !== this.version) return;
        this.setStatus(locallySaved ? 'Sync unavailable · Saved on this device' : 'Could not save. Export your plan before closing.', true);
      }
    });
  }
  reconnect() {
    if (!this.uid) { this.setStatus(this.guestStatus()); return; }
    let dirty = false;
    try { dirty = this.readCache(this.uid)?.dirty === true; } catch { /* Opening reports invalid caches. */ }
    if (this.ready && dirty) this.sync();
    else this.switchUser(this.platform.getCurrentUser());
  }
}
