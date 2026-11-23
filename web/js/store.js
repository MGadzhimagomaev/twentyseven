// The app's data: what's on screen, what's waiting to be saved, and what Undo can
// take back. Every change shows at once and is saved in the background. Changes
// made offline wait on this device and go out when the connection is back.
import { uuid, isoDate, addDays, timeZone } from './util.js';
import { weekOf } from './week.js';
import { bundleByKey, matchBundle, idFor, cleanName, isTraining, TRAINING_TARGET } from './bundles.js';
import { classify } from './api.js';

const CACHE = 'twentyseven.v2.';
export const WEEKS_KEPT = 12;            // weeks of sets kept on the device; Sets can step back through them
const UNDO_MAX = 30;
const MERGE_MS = 2000;                   // stepper taps this close together undo as one step
const RETRY_MS = [2000, 5000, 15000, 30000, 60000];
const REFRESH_AFTER_MS = 60000;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const groupRow = g => ({ id: g.id, name: g.name, kind: g.kind || 'sets', position: g.position, own_target: g.own_target ?? null, archived_at: g.archived_at ?? null });
const sameRow = (a, b) => a.name === b.name && (a.kind || 'sets') === (b.kind || 'sets') && a.position === b.position
  && (a.own_target ?? null) === (b.own_target ?? null) && !!a.archived_at === !!b.archived_at;

function blank() {
  return {
    phase: 'starting',     // starting | signed-out | loading | ready
    user: null,            // { id, email }
    settings: null,
    groups: [],            // every group, removed ones too (archived_at set)
    entries: [],           // sets from the last WEEKS_KEPT weeks: +1 / −1 rows
    steps: [],             // [{ day, steps }] synced by the iPhone app
    history: null,         // { progress, steps, weekStart, at } from the database
    pending: [],           // changes not saved yet, oldest first
    undo: [],              // this device's actions, newest last
    sync: 'saved',         // saved | saving | offline | error | expired
    loadedAt: 0,
    loadError: null,
    linkError: null,
    recapSeen: null,       // the week whose recap card was closed
    showTips: false,
  };
}

export function createStore(api) {
  let s = blank();
  const listeners = new Set();
  const noticeListeners = new Set();
  let emitQueued = false;
  let flushTimer = 0, retryTimer = 0, flushing = false, retryStep = 0, refreshing = null;

  // ---------- plumbing ----------
  function emit() {
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(() => {
      emitQueued = false;
      for (const fn of listeners) fn(s);
    });
  }
  const notice = text => { for (const fn of noticeListeners) fn(text); };
  function setSync(state) {
    if (s.sync !== state) { s.sync = state; emit(); }
  }

  function persist() {
    if (!s.user) return;
    const keep = {
      v: 2, settings: s.settings, groups: s.groups, entries: s.entries, steps: s.steps, history: s.history,
      pending: s.pending.map(({ sending, ...op }) => op), undo: s.undo, loadedAt: s.loadedAt, recapSeen: s.recapSeen,
    };
    try { localStorage.setItem(CACHE + s.user.id, JSON.stringify(keep)); } catch { /* full or blocked: the server still has it */ }
  }
  function restore(uid) {
    try {
      const d = JSON.parse(localStorage.getItem(CACHE + uid) || 'null');
      return d && d.v === 2 ? d : null;
    } catch { return null; }
  }
  const forget = uid => { try { localStorage.removeItem(CACHE + uid); } catch { /* ignore */ } };

  // ---------- signing in and out ----------
  async function init({ linkError = null } = {}) {
    s.linkError = linkError;
    api.onAuthChange((event, user) => {
      if (event === 'SIGNED_OUT') { if (s.user) reset(); }
      else if (user && s.user?.id !== user.id) start(user);
      else if (user && event === 'TOKEN_REFRESHED' && s.sync === 'expired') { setSync('saving'); flush(); }
    });
    let user = null;
    try { user = await api.session(); } catch { /* no session */ }
    if (user) await start(user);
    else if (!s.user) { s.phase = 'signed-out'; emit(); }
  }

  async function start(user) {
    if (s.user?.id === user.id) return;
    const cached = restore(user.id);
    s = { ...blank(), user, phase: 'loading' };
    if (cached) {
      for (const k of ['settings', 'groups', 'entries', 'steps', 'history', 'pending', 'undo', 'loadedAt', 'recapSeen']) {
        if (cached[k] != null) s[k] = cached[k];
      }
      if (s.settings) s.phase = 'ready';
    }
    emit();
    await refresh();
    flush();
  }

  function reset() {
    clearTimeout(flushTimer); clearTimeout(retryTimer);
    s = { ...blank(), phase: 'signed-out' };
    emit();
  }

  const sendCode = email => api.sendCode(email);
  const verifyCode = (email, code) => api.verifyCode(email, code);

  async function signOut() {
    const uid = s.user?.id;
    await api.signOut();
    if (uid) forget(uid);
    reset();
  }

  async function deleteAccount() {
    const uid = s.user?.id;
    await api.deleteAccount();
    if (uid) forget(uid);
    reset();
  }

  // ---------- loading ----------
  function refresh() {
    if (!s.user) return Promise.resolve();
    if (refreshing) return refreshing;
    const uid = s.user.id;
    refreshing = (async () => {
      try {
        let settings = await api.loadSettings();
        if (!settings) {
          await api.createSettings();
          settings = await api.loadSettings();
        }
        const since = addDays(isoDate(), -7 * WEEKS_KEPT - 6);
        const [groups, entries, steps] = await Promise.all([api.loadGroups(), api.loadEntries(since), api.loadSteps(since)]);
        if (s.user?.id !== uid) return;
        merge(settings, groups, entries, steps);
        s.loadedAt = Date.now();
        if (s.history) s.history.at = 0;      // past weeks' targets are fetched again when next needed
        s.loadError = null;
        s.phase = 'ready';
        if (s.sync !== 'saving' && s.sync !== 'error') s.sync = s.pending.length ? 'saving' : 'saved';
        // "This week" on the server follows the person's zone, so keep it current.
        if (s.settings.onboarded_at && s.settings.time_zone !== timeZone()) queueSettings({ time_zone: timeZone() });
        persist();
        emit();
      } catch (e) {
        if (s.user?.id !== uid) return;
        const err = classify(e);
        if (err.kind === 'network') setSync('offline');
        else if (err.kind === 'auth') await expired();
        else { console.error(err); setSync('error'); }
        if (s.phase === 'loading') s.loadError = err;
        emit();
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  // The database's rows, with this device's unsaved changes laid on top.
  function merge(settings, groups, entries, steps) {
    const adds = new Map(), dels = new Set(), rows = new Map();
    const patch = {};
    for (const op of s.pending) {
      if (op.kind === 'add') { adds.set(op.row.id, op.row); dels.delete(op.row.id); }
      else if (op.kind === 'del') { dels.add(op.id); adds.delete(op.id); }
      else if (op.kind === 'settings') Object.assign(patch, op.patch);
      else if (op.kind === 'groups') for (const r of op.rows) rows.set(r.id, r);
    }
    s.settings = { ...settings, ...patch };
    const byId = new Map(groups.map(g => [g.id, g]));
    for (const r of rows.values()) byId.set(r.id, { ...byId.get(r.id), ...r });
    s.groups = [...byId.values()].sort((a, b) => a.position - b.position);
    const seen = new Set();
    s.entries = entries.filter(e => !dels.has(e.id)).map(e => { seen.add(e.id); return e; });
    for (const row of adds.values()) if (!seen.has(row.id)) s.entries.push(row);
    s.steps = steps;
  }

  async function loadHistory(force = false) {
    if (!s.user || !s.settings) return;
    const fresh = s.history && s.history.weekStart === s.settings.week_start && Date.now() - s.history.at < REFRESH_AFTER_MS;
    if (fresh && !force) return;
    try {
      await flushNow();
      const [progress, steps] = await Promise.all([api.weeklyProgress(WEEKS_KEPT), api.weeklySteps(WEEKS_KEPT)]);
      s.history = { progress, steps, weekStart: s.settings.week_start, at: Date.now() };
      s.historyError = null;
      persist();
    } catch (e) {
      s.historyError = classify(e);
    }
    emit();
  }

  async function activity(offset, limit) {
    await flushNow();
    return api.activityLog(offset, limit);
  }

  async function exportData() {
    await flushNow();
    return api.exportAll();
  }

  // ---------- saving ----------
  function scheduleFlush(ms = 400) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms);
  }
  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, RETRY_MS[Math.min(retryStep++, RETRY_MS.length - 1)]);
  }

  async function expired() {
    // A request was turned away: check whether the sign-in still holds.
    let user = null;
    try { user = await api.session(); } catch { /* treat as gone */ }
    if (!user) reset(); else { setSync('expired'); retryLater(); }
  }

  async function flush() {
    clearTimeout(flushTimer);
    if (flushing || !s.user) return;
    if (!s.pending.length) { if (s.sync === 'saving') setSync('saved'); return; }
    flushing = true;
    setSync('saving');
    const uid = s.user.id;
    try {
      while (s.pending.length && s.user?.id === uid) {
        const first = s.pending[0];
        let batch = [first];
        if (first.kind === 'add') {
          batch = [];
          for (const op of s.pending) {
            if (op.kind !== 'add' || batch.length === 200) break;
            batch.push(op);
          }
        }
        for (const op of batch) op.sending = true;
        try {
          if (first.kind === 'add') await api.addEntries(batch.map(op => op.row));
          else if (first.kind === 'del') await api.deleteEntry(first.id);
          else if (first.kind === 'settings') await api.saveSettings(first.patch);
          else if (first.kind === 'groups') await api.saveGroups(first.rows);
        } finally {
          for (const op of batch) op.sending = false;
        }
        s.pending = s.pending.filter(op => !batch.includes(op));
        retryStep = 0;
        persist();
      }
      if (s.user?.id === uid) setSync(s.pending.length ? 'saving' : 'saved');
    } catch (e) {
      const err = classify(e);
      if (err.kind === 'network') { setSync('offline'); retryLater(); }
      else if (err.kind === 'auth') await expired();
      else {
        const op = s.pending[0];
        console.error('Could not save', op, err);
        op.tries = (op.tries || 0) + 1;
        if (op.tries >= 3) {
          // Something the database keeps refusing: drop it so the rest can go through.
          s.pending.shift();
          persist();
          notice('A change couldn’t be saved, so it was left out.');
          refresh();
        }
        setSync('error');
        retryLater();
      }
    } finally {
      flushing = false;
    }
    if (s.pending.length && s.sync === 'saving') scheduleFlush(0);
  }

  // Saves now and waits, so lists read from the database include the latest taps.
  async function flushNow() {
    if (flushing) await new Promise(r => setTimeout(r, 300));
    await flush();
  }

  function queueSettings(patch) {
    const last = s.pending.at(-1);
    if (last && last.kind === 'settings' && !last.sending) Object.assign(last.patch, patch);
    else s.pending.push({ kind: 'settings', patch: { ...patch } });
    s.settings = { ...s.settings, ...patch };
    persist(); scheduleFlush(); emit();
  }

  function queueGroups(rows) {
    const last = s.pending.at(-1);
    if (last && last.kind === 'groups' && !last.sending) {
      const byId = new Map(last.rows.map(r => [r.id, r]));
      for (const r of rows) byId.set(r.id, r);
      last.rows = [...byId.values()];
    } else {
      s.pending.push({ kind: 'groups', rows: rows.map(r => ({ ...r })) });
    }
    const byId = new Map(s.groups.map(g => [g.id, g]));
    for (const r of rows) byId.set(r.id, { ...byId.get(r.id), ...r });
    s.groups = [...byId.values()].sort((a, b) => a.position - b.position);
    persist(); scheduleFlush(); emit();
  }

  // Takes a set off the device and the database: an unsent one simply never goes.
  function dropEntry(id) {
    s.entries = s.entries.filter(e => e.id !== id);
    const i = s.pending.findIndex(op => op.kind === 'add' && op.row.id === id && !op.sending);
    if (i >= 0) s.pending.splice(i, 1);
    else s.pending.push({ kind: 'del', id });
  }
  // Puts a removed set back under its old id.
  function putEntry(row) {
    if (!s.entries.some(e => e.id === row.id)) s.entries.push(row);
    const i = s.pending.findIndex(op => op.kind === 'del' && op.id === row.id && !op.sending);
    if (i >= 0) s.pending.splice(i, 1);
    else s.pending.push({ kind: 'add', row });
  }

  // History is fetched from the database; after a change it is fetched again the
  // next time it opens, so a set added to a past week shows right away.
  const stale = () => { if (s.history) s.history.at = 0; };

  // ---------- undo ----------
  function pushUndo(item) {
    const last = s.undo.at(-1);
    if (item.type === 'settings' && last?.type === 'settings' && last.field === item.field && item.at - last.at < MERGE_MS) {
      last.after = item.after; last.label = item.label; last.at = item.at;
      if (last.before[item.field] === item.after[item.field]) s.undo.pop();
    } else {
      s.undo.push(item);
      if (s.undo.length > UNDO_MAX) s.undo.shift();
    }
  }

  function undo() {
    const item = s.undo.pop();
    if (!item) return null;
    stale();
    if (item.type === 'entry') dropEntry(item.row.id);
    else if (item.type === 'removed') putEntry(item.row);
    else if (item.type === 'settings') queueSettings(item.before);
    else if (item.type === 'groups') {
      queueGroups(item.before);
      if (item.bundleBefore && item.bundleBefore !== s.settings.bundle) queueSettings({ bundle: item.bundleBefore });
    }
    persist(); scheduleFlush(); emit();
    return item;
  }

  // ---------- reading ----------
  const weekStart = () => s.settings?.week_start || 'monday';
  const goal = () => s.settings?.weekly_goal ?? 20;
  const activeGroups = () => s.groups.filter(g => !g.archived_at).sort((a, b) => a.position - b.position);
  const muscleGroups = () => activeGroups().filter(g => !isTraining(g));
  const trainings = () => activeGroups().filter(isTraining);
  const targetOf = g => g.own_target ?? goal();
  const currentWeek = () => weekOf(new Date(), weekStart());

  function countsIn(week) {
    const m = new Map();
    for (const e of s.entries) {
      if (e.local_date >= week.start && e.local_date <= week.end) m.set(e.group_id, (m.get(e.group_id) || 0) + e.delta);
    }
    return m;
  }

  // One tile per group for the given week, with the target that applied then.
  function tiles(week) {
    const counts = countsIn(week);
    const isCurrent = week.start === currentWeek().start;
    let then = null;
    if (!isCurrent && s.history && s.history.weekStart === weekStart()) {
      then = new Map(s.history.progress.filter(r => r.week_start === week.start).map(r => [r.group_id, r.target]));
    }
    return activeGroups().map(g => {
      const count = Math.max(0, counts.get(g.id) || 0);
      const target = then?.get(g.id) ?? targetOf(g);
      const training = isTraining(g);
      return { group: g, training, count, target, own: isCurrent && !training && g.own_target != null, done: count >= target };
    });
  }

  function stepsIn(week) {
    const today = isoDate();
    const days = s.steps.filter(d => d.day >= week.start && d.day <= week.end && d.day <= today && d.steps > 0);
    const avg = days.length ? days.reduce((t, d) => t + d.steps, 0) / days.length : null;
    return { avg, days: days.length, goal: s.settings?.step_goal ?? 10000, any: s.steps.length > 0 };
  }

  // Sets and trainings add up separately, so a run never counts as a set.
  function summary(week) {
    const t = tiles(week);
    const sets = t.filter(x => !x.training), runs = t.filter(x => x.training);
    const add = (list, k) => list.reduce((n, x) => n + x[k], 0);
    return {
      sets: add(sets, 'count'),
      target: add(sets, 'target'),
      done: sets.filter(x => x.done).length,
      groups: sets.length,
      trainings: { count: add(runs, 'count'), target: add(runs, 'target'), done: runs.filter(x => x.done).length, n: runs.length },
      steps: stepsIn(week),
    };
  }

  // Weeks of history with this device's newer counts laid over the database's.
  function historyRows() {
    if (!s.history || s.history.weekStart !== weekStart()) return null;
    const oldest = addDays(currentWeek().start, -7 * (WEEKS_KEPT - 1));
    const cache = new Map();
    return s.history.progress.map(r => {
      if (r.week_start < oldest) return r;
      let counts = cache.get(r.week_start);
      if (!counts) cache.set(r.week_start, (counts = countsIn({ start: r.week_start, end: r.week_end })));
      const sets = Math.max(0, counts.get(r.group_id) || 0);
      return { ...r, sets, at_goal: sets >= r.target };
    });
  }

  // ---------- changing ----------
  function tap(groupId, delta, week) {
    const group = s.groups.find(g => g.id === groupId);
    if (!group || !s.user) return null;
    if (delta < 0 && (countsIn(week).get(groupId) || 0) <= 0) return null;
    const today = isoDate();
    const row = {
      id: uuid(), group_id: groupId, delta,
      local_date: today >= week.start && today <= week.end ? today : week.end,
      logged_at: new Date().toISOString(), source: 'web',
    };
    s.entries.push(row);
    s.pending.push({ kind: 'add', row });
    stale();
    pushUndo({ type: 'entry', row, label: `${group.name} ${delta > 0 ? '+1' : '−1'}`, at: Date.now() });
    persist(); scheduleFlush(); emit();
    return row;
  }

  // Goal, week start, step goal, steps on Sets. `label` names it for Undo.
  function setSetting(field, value, label) {
    if (!s.settings || s.settings[field] === value) return;
    const before = { [field]: s.settings[field] };
    stale();
    queueSettings({ [field]: value });
    pushUndo({ type: 'settings', field, before, after: { [field]: value }, label, at: Date.now() });
    persist(); emit();
  }
  const setGoal = n => setSetting('weekly_goal', clamp(n, 1, 50), `Goal ${clamp(n, 1, 50)}`);

  // Saves the edited list of groups. Each draft row is { id?, name, own_target }:
  // an id keeps a group (and its sets) or brings a removed one back; groups missing
  // from the list are removed but keep their history.
  function groupRowsFor(draft) {
    const now = new Date().toISOString();
    const byId = new Map(s.groups.map(g => [g.id, g]));
    const taken = new Set(s.groups.map(g => g.id));
    const used = new Set();
    const rows = [];
    draft.forEach((d, i) => {
      const name = cleanName(d.name);
      const kind = d.kind === 'sessions' ? 'sessions' : 'sets';
      let id = d.id;
      if (!id || used.has(id)) {
        // A removed group of the same kind and name comes back with its history.
        const own = idFor(name, new Set()), old = byId.get(own);
        id = old?.archived_at && (old.kind || 'sets') === kind && !used.has(own) ? own : idFor(name, taken);
      }
      taken.add(id); used.add(id);
      const target = kind === 'sessions' ? (d.own_target ?? TRAINING_TARGET) : (d.own_target ?? null);
      rows.push({ id, name, kind, position: i, own_target: target, archived_at: null });
    });
    for (const g of s.groups) {
      if (!used.has(g.id) && !g.archived_at) rows.push({ ...groupRow(g), archived_at: now });
    }
    return rows.filter(r => !byId.has(r.id) || !sameRow(byId.get(r.id), r));
  }

  function saveGroupList(draft, label = 'Group changes') {
    const now = new Date().toISOString();
    const byId = new Map(s.groups.map(g => [g.id, g]));
    const changed = groupRowsFor(draft);
    if (!changed.length) return false;
    const before = changed.map(r => (byId.has(r.id) ? groupRow(byId.get(r.id)) : { ...r, archived_at: now }));
    const bundleBefore = s.settings.bundle;
    stale();
    queueGroups(changed);
    const bundle = matchBundle(muscleGroups());
    if (bundle !== bundleBefore) queueSettings({ bundle });
    pushUndo({ type: 'groups', before, bundleBefore, label, at: Date.now() });
    persist(); emit();
    return true;
  }

  // First launch: groups first, so they don't show up as "added", then the settings
  // that mark setup as finished.
  // `bundle` may be 'none' for someone who only counts trainings.
  function completeSetup({ bundle, weekStart: ws, goal: g, trainings: picked = [] }) {
    const b = bundleByKey(bundle);
    const draft = [
      ...(b ? b.groups.map(([id, name]) => ({ id, name, kind: 'sets', own_target: null })) : []),
      ...picked.map(t => ({ id: t.id, name: t.name, kind: 'sessions', own_target: t.own_target })),
    ];
    const changed = groupRowsFor(draft);
    if (changed.length) queueGroups(changed);
    queueSettings({ bundle: b ? bundle : 'custom', week_start: ws, weekly_goal: clamp(g, 1, 50), time_zone: timeZone(), onboarded_at: new Date().toISOString() });
    s.showTips = true;
    persist(); emit();
    flush();
  }

  // Removes a set picked from the activity log (a row of the activity_log view).
  function removeEntry(r) {
    const group = s.groups.find(g => g.id === r.group_id);
    const delta = Number(r.new_value);
    const row = { id: r.ref, group_id: r.group_id, delta, local_date: r.local_date, logged_at: r.happened_at, source: r.source || 'web' };
    dropEntry(row.id);
    stale();
    pushUndo({ type: 'removed', row, label: `${group?.name ?? 'Set'} ${delta > 0 ? '+' : '−'}${Math.abs(delta)} removed`, at: Date.now() });
    persist(); scheduleFlush(); emit();
    return row;
  }

  function closeRecap(weekId) { s.recapSeen = weekId; persist(); emit(); }
  function setShowTips(on) { s.showTips = on; emit(); }

  // Back online, or back to the app after a while: save and catch up.
  function wake() {
    if (!s.user) return;
    flush();
    if (Date.now() - s.loadedAt > REFRESH_AFTER_MS) refresh();
  }

  return {
    get state() { return s; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onNotice(fn) { noticeListeners.add(fn); return () => noticeListeners.delete(fn); },
    init, sendCode, verifyCode, signOut, deleteAccount, refresh, wake,
    loadHistory, activity, exportData, flushNow,
    weekStart, goal, activeGroups, muscleGroups, trainings, targetOf, currentWeek, countsIn, tiles, summary, stepsIn, historyRows,
    tap, setGoal, setSetting, saveGroupList, completeSetup, removeEntry, undo,
    lastUndo: () => s.undo.at(-1) || null,
    closeRecap, setShowTips,
  };
}
