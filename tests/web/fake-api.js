// A stand-in for Supabase, loaded into the page before the app starts. It keeps
// its "database" in localStorage so reloads see the same data, and behaves like
// the real tables and triggers closely enough to test the screens.
// Controls on window.__fake: offline (bool), failNext ('auth' | 'other'), sent (emails), calls (method names).
(() => {
  if (location.protocol === 'about:') return;
  const DB = 'fake.db', SESSION = 'fake.session';
  const fake = window.__fake = Object.assign({ offline: false, failNext: null, sent: [], calls: [], code: '123456' }, window.__fake || {});
  const load = () => JSON.parse(localStorage.getItem(DB) || '{"users":{},"settings":{},"groups":{},"entries":{},"steps":{},"changes":{}}');
  const save = db => localStorage.setItem(DB, JSON.stringify(db));
  const listeners = [];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
  const weekStartOf = (s, ws) => { const [y, m, d] = s.split('-').map(Number); const dow = (new Date(y, m - 1, d).getDay() + 6) % 7 + 1; return addDays(s, -((dow - (ws === 'sunday' ? 7 : 1) + 7) % 7)); };

  let user = JSON.parse(localStorage.getItem(SESSION) || 'null');

  async function call(name, fn) {
    fake.calls.push(name);
    await new Promise(r => setTimeout(r, fake.delay ?? 5));
    if (fake.offline) throw new TypeError('Failed to fetch');
    if (fake.failNext) {
      const kind = fake.failNext; fake.failNext = null;
      if (kind === 'auth') throw Object.assign(new Error('JWT expired'), { status: 401 });
      throw Object.assign(new Error('something broke'), { code: 'XX000' });
    }
    return fn();
  }
  const me = () => { if (!user) throw Object.assign(new Error('JWT missing'), { status: 401 }); return user.id; };

  function logChange(db, uid, kind, extra) {
    const list = db.changes[uid] || (db.changes[uid] = []);
    list.push({ id: list.length + 1, kind, local_date: today(), changed_at: new Date().toISOString(), group_id: null, old_value: null, new_value: null, ...extra });
  }

  function signIn(email) {
    const db = load();
    let id = Object.keys(db.users).find(k => db.users[k] === email);
    if (!id) {
      id = 'user-' + (Object.keys(db.users).length + 1);
      db.users[id] = email;
      db.settings[id] = { user_id: id, bundle: 'extended', week_start: 'monday', weekly_goal: 20, step_goal: 10000, show_steps_on_sets: false, time_zone: 'Europe/Berlin', onboarded_at: null };
      db.groups[id] = []; db.entries[id] = []; db.steps[id] = []; db.changes[id] = [];
      save(db);
    }
    user = { id, email };
    localStorage.setItem(SESSION, JSON.stringify(user));
    for (const cb of listeners) setTimeout(() => cb('SIGNED_IN', user), 0);
    return user;
  }
  fake.signIn = signIn;          // a test can sign in directly, like a clicked email link
  fake.db = load;
  fake.seed = fn => { const db = load(); fn(db, user?.id); save(db); };

  window.__TWENTYSEVEN_API__ = {
    async session() { return user; },
    onAuthChange(cb) { listeners.push(cb); },
    sendCode: email => call('sendCode', () => {
      if (email === 'blocked@example.com') throw Object.assign(new Error('Signups not allowed for otp'), { code: 'signup_disabled' });
      fake.sent.push(email);
    }),
    verifyCode: (email, token) => call('verifyCode', () => {
      if (token !== fake.code) throw Object.assign(new Error('Token has expired or is invalid'), { code: 'otp_expired', status: 403 });
      return signIn(email);
    }),
    async signOut() { user = null; localStorage.removeItem(SESSION); for (const cb of listeners) setTimeout(() => cb('SIGNED_OUT', null), 0); },

    loadSettings: () => call('loadSettings', () => { const db = load(); return db.settings[me()] ? { ...db.settings[me()] } : null; }),
    createSettings: () => call('createSettings', () => null),
    saveSettings: patch => call('saveSettings', () => {
      const db = load(), uid = me(), old = db.settings[uid], next = { ...old, ...patch };
      if (old.onboarded_at) {
        for (const k of ['weekly_goal', 'step_goal', 'week_start']) {
          if (k in patch && String(old[k]) !== String(next[k])) logChange(db, uid, k, { old_value: String(old[k]), new_value: String(next[k]) });
        }
      }
      db.settings[uid] = next; save(db);
    }),

    loadGroups: () => call('loadGroups', () => load().groups[me()].map(g => ({ kind: 'sets', ...g }))),
    saveGroups: rows => call('saveGroups', () => {
      const db = load(), uid = me(), list = db.groups[uid], set = !!db.settings[uid].onboarded_at;
      for (const r of rows) {
        if (r.kind === 'sessions' && r.own_target == null) throw Object.assign(new Error('violates check constraint "sessions_have_a_target"'), { code: '23514' });
        const old = list.find(g => g.id === r.id);
        if (!old) {
          list.push({ ...r, created_at: new Date().toISOString() });
          if (set) logChange(db, uid, 'group_added', { group_id: r.id, new_value: r.name });
          if (r.own_target != null) logChange(db, uid, 'group_target', { group_id: r.id, new_value: String(r.own_target) });
          continue;
        }
        if (old.name !== r.name) logChange(db, uid, 'group_renamed', { group_id: r.id, old_value: old.name, new_value: r.name });
        if ((old.own_target ?? null) !== (r.own_target ?? null)) logChange(db, uid, 'group_target', { group_id: r.id, old_value: old.own_target == null ? null : String(old.own_target), new_value: r.own_target == null ? null : String(r.own_target) });
        if (!old.archived_at && r.archived_at) logChange(db, uid, 'group_removed', { group_id: r.id });
        if (old.archived_at && !r.archived_at) logChange(db, uid, 'group_restored', { group_id: r.id });
        Object.assign(old, r);
      }
      save(db);
    }),

    loadEntries: from => call('loadEntries', () => load().entries[me()].filter(e => e.local_date >= from).sort((a, b) => a.logged_at.localeCompare(b.logged_at))),
    addEntries: rows => call('addEntries', () => {
      const db = load(), list = db.entries[me()];
      for (const r of rows) {
        if (!list.some(e => e.id === r.id)) {
          if (!db.groups[me()].some(g => g.id === r.group_id)) throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
          list.push({ ...r });
        }
      }
      save(db);
    }),
    deleteEntry: id => call('deleteEntry', () => { const db = load(); db.entries[me()] = db.entries[me()].filter(e => e.id !== id); save(db); }),

    loadSteps: from => call('loadSteps', () => load().steps[me()].filter(d => d.day >= from)),
    weeklyProgress: weeks => call('weeklyProgress', () => {
      const db = load(), uid = me(), st = db.settings[uid];
      const now = weekStartOf(today(), st.week_start);
      const out = [];
      for (let i = 0; i < weeks; i++) {
        const ws = addDays(now, -7 * i), we = addDays(ws, 6);
        for (const g of db.groups[uid]) {
          const sets = db.entries[uid].filter(e => e.group_id === g.id && e.local_date >= ws && e.local_date <= we).reduce((t, e) => t + e.delta, 0);
          const active = (!g.archived_at || g.archived_at.slice(0, 10) > ws) && g.created_at.slice(0, 10) <= we;
          if (!active && !sets) continue;
          const target = g.own_target ?? st.weekly_goal;
          out.push({ week_start: ws, week_end: we, group_id: g.id, group_name: g.name, position: g.position, archived: !!g.archived_at, sets, target, at_goal: sets >= target });
        }
      }
      return out;
    }),
    weeklySteps: weeks => call('weeklySteps', () => {
      const db = load(), uid = me(), st = db.settings[uid];
      const now = weekStartOf(today(), st.week_start);
      const out = [];
      for (let i = 0; i < weeks; i++) {
        const ws = addDays(now, -7 * i), we = addDays(ws, 6);
        const days = db.steps[uid].filter(d => d.day >= ws && d.day <= we && d.steps > 0);
        out.push({ week_start: ws, avg_steps: days.length ? days.reduce((t, d) => t + d.steps, 0) / days.length : null, days_logged: days.length, days_at_goal: days.filter(d => d.steps >= st.step_goal).length });
      }
      return out;
    }),
    activityLog: (offset, limit) => call('activityLog', () => {
      const db = load(), uid = me();
      const name = id => db.groups[uid].find(g => g.id === id)?.name;
      const rows = [
        ...db.entries[uid].map(e => ({ kind: 'set', ref: e.id, group_id: e.group_id, group_name: name(e.group_id), old_value: null, new_value: String(e.delta), source: e.source, local_date: e.local_date, happened_at: e.logged_at })),
        ...db.changes[uid].map(c => ({ kind: c.kind, ref: String(c.id), group_id: c.group_id, group_name: name(c.group_id), old_value: c.old_value, new_value: c.new_value, source: null, local_date: c.local_date, happened_at: c.changed_at })),
      ].sort((a, b) => b.happened_at.localeCompare(a.happened_at));
      return rows.slice(offset, offset + limit);
    }),
    exportAll: () => call('exportAll', () => {
      const db = load(), uid = me();
      return { settings: db.settings[uid], groups: db.groups[uid], sets: db.entries[uid], steps: db.steps[uid], changes: db.changes[uid] };
    }),
    deleteAccount: () => call('deleteAccount', async () => {
      const db = load(), uid = me();
      for (const t of ['settings', 'groups', 'entries', 'steps', 'changes', 'users']) delete db[t][uid];
      save(db);
      user = null; localStorage.removeItem(SESSION);
    }),
  };
})();
