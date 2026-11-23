// Runs the migration in PGlite (Postgres in WebAssembly) with a stand-in for
// Supabase's auth schema, then checks history, targets, week starts, steps,
// privacy between two people, and account deletion.
//
// usage: node supabase/tests/run.mjs <path to node_modules with @electric-sql/pglite>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = process.argv[2];
const require = createRequire(path.join(modules, 'x.js'));
const { PGlite } = await import(require.resolve('@electric-sql/pglite'));

const migration = readFileSync(path.join(here, '..', 'migrations', '20261123000000_init.sql'), 'utf8');

// What Supabase provides before any migration runs.
const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;
// No default grants: the migration has to grant everything the app needs itself,
// as on a project where "Grant API access to new tables automatically" is off.
const db = new PGlite();
await db.exec(STUB);
await db.exec(migration);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

async function as(uid, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function asFails(uid, sql, params, pattern) {
  try {
    await as(uid, sql, params);
  } catch (e) {
    if (pattern) assert.match(String(e.message), pattern);
    checks++;
    return;
  }
  assert.fail(`expected failure: ${sql}`);
}
const sys = async (sql, params) => db.query(sql, params);
const one = r => r.rows[0];

// Dates relative to today in the person's zone, like the app sends them.
const today = one(await sys(`select (now() at time zone 'Europe/Berlin')::date::text as d`)).d;
const monday = one(await sys(`select public.week_start_of($1::date, 'monday')::text as d`, [today])).d;
const shift = async (d, days) => one(await sys(`select ($1::date + $2::int)::text as d`, [d, days])).d;

// ---------- week math ----------
const cases = [
  ['2026-11-23', 'monday', '2026-11-23'], ['2026-11-29', 'monday', '2026-11-23'],
  ['2026-11-25', 'sunday', '2026-11-22'], ['2026-11-22', 'sunday', '2026-11-22'],
  ['2026-11-28', 'sunday', '2026-11-22'], ['2027-01-01', 'monday', '2026-12-28'],
];
for (const [d, ws, want] of cases) {
  const got = one(await sys(`select public.week_start_of($1::date, $2)::text as d`, [d, ws])).d;
  ok(got === want, `week_start_of(${d}, ${ws}) = ${got}, want ${want}`);
}

// ---------- sign-up creates settings and a starting goal ----------
await sys(`insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`, [A, B]);
ok(one(await sys(`select count(*)::int as n from public.settings`)).n === 2, 'settings row per new user');
ok(one(await sys(`select count(*)::int as n from public.changes where user_id = $1 and local_date = '-infinity'`, [A])).n === 2,
  'starting weekly and step goals recorded');

// ---------- setup: time zone, bundle, groups ----------
await as(A, `update public.settings set time_zone = 'Mars/Phobos' where user_id = $1`, [A]);
ok(one(await sys(`select time_zone from public.settings where user_id = $1`, [A])).time_zone === 'UTC', 'unknown time zone falls back to UTC');
await as(A, `update public.settings set time_zone = 'Europe/Berlin', bundle = 'extended' where user_id = $1`, [A]);
const extended = [['legs', 'Legs'], ['back', 'Back'], ['chest', 'Chest'], ['core', 'Core'], ['biceps', 'Biceps'], ['triceps', 'Triceps'], ['delts', 'Delts']];
for (const [i, [id, name]] of extended.entries()) {
  await as(A, `insert into public.muscle_groups (id, name, position) values ($1, $2, $3)`, [id, name, i]);
}
ok(one(await sys(`select count(*)::int as n from public.changes where user_id = $1 and kind = 'group_added'`, [A])).n === 0,
  'groups added during setup are not listed as activity');
await as(A, `update public.settings set onboarded_at = now() where user_id = $1`, [A]);
await as(A, `insert into public.muscle_groups (id, name, position) values ('forearms', 'Forearms', 7)`);
ok(one(await sys(`select count(*)::int as n from public.changes where user_id = $1 and kind = 'group_added'`, [A])).n === 1,
  'a group added after setup is listed');

// ---------- sets ----------
const uuid = async () => one(await sys(`select gen_random_uuid()::text as u`)).u;
const tap = async (uid, group, delta, date = today, source = 'web') =>
  as(uid, `insert into public.set_entries (id, group_id, delta, local_date, source) values ($1, $2, $3, $4, $5)`,
    [await uuid(), group, delta, date, source]);

for (let i = 0; i < 3; i++) await tap(A, 'legs', 1);
await tap(A, 'legs', -1);
await tap(A, 'chest', 1);
await asFails(A, `insert into public.set_entries (id, group_id, delta, local_date) values (gen_random_uuid(), 'legs', 2, $1)`, [today], /check/);
await asFails(A, `insert into public.set_entries (id, group_id, delta, local_date) values (gen_random_uuid(), 'nope', 1, $1)`, [today], /foreign key/);

const w3 = await shift(monday, -21), w2 = await shift(monday, -14), w1 = await shift(monday, -7);
await tap(A, 'legs', 21, w3, 'import');
await tap(A, 'core', 13, w2, 'import');
await tap(A, 'core', 9, w1, 'import');

// A retried sync of the same entry is rejected, so nothing counts twice.
const fixed = await uuid();
await as(A, `insert into public.set_entries (id, group_id, delta, local_date) values ($1, 'back', 1, $2)`, [fixed, today]);
await asFails(A, `insert into public.set_entries (id, group_id, delta, local_date) values ($1, 'back', 1, $2)`, [fixed, today], /duplicate key/);

// ---------- targets over time ----------
// A goal change two weeks ago (written as the trigger would have), then one today.
await sys(`insert into public.changes (user_id, kind, old_value, new_value, local_date) values ($1, 'weekly_goal', '20', '18', $2)`, [A, w2]);
await as(A, `update public.settings set weekly_goal = 22 where user_id = $1`, [A]);
// Core got its own target last week, then today it is unlocked again.
await sys(`insert into public.changes (user_id, kind, group_id, old_value, new_value, local_date) values ($1, 'group_target', 'core', null, '10', $2)`, [A, w1]);
await as(A, `update public.muscle_groups set own_target = 12 where id = 'delts'`);

const grid = async (uid, weeks = 4) => (await as(uid, `select * from public.weekly_progress($1)`, [weeks])).rows;
let rows = await grid(A);
const cell = (week, g) => rows.find(r => String(r.week_start.toISOString?.() ?? r.week_start).slice(0, 10) === week && r.group_id === g);
const iso = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const at = (week, g) => rows.find(r => iso(r.week_start) === week && r.group_id === g);

ok(at(monday, 'legs').sets === 2, 'this week: 3 taps minus 1 undo = 2 legs sets');
ok(at(monday, 'legs').target === 22, 'this week follows today\'s goal of 22');
ok(at(monday, 'delts').target === 12 && at(monday, 'delts').sets === 0, 'delts has its own target of 12 and shows 0 sets');
ok(rows.filter(r => iso(r.week_start) === monday).length === 8, 'this week lists all 8 groups, even with no sets');
ok(at(w3, 'legs').sets === 21 && at(w3, 'legs').target === 20 && at(w3, 'legs').at_goal === true, 'three weeks ago: imported 21/20, at goal');
ok(at(w2, 'core').target === 18 && at(w2, 'core').sets === 13, 'two weeks ago: goal was 18');
ok(at(w1, 'core').target === 10 && at(w1, 'core').at_goal === false, 'last week: core had its own target of 10, 9 sets');
ok(!at(w3, 'chest'), 'groups created later only show in old weeks when they have sets');

await as(A, `update public.muscle_groups set own_target = null where id = 'delts'`);
rows = await grid(A);
ok(at(monday, 'delts').target === 22, 'unlocking delts makes it follow the goal again');

// ---------- removing and restoring a group keeps its history ----------
await as(A, `update public.muscle_groups set archived_at = now() where id = 'core'`);
rows = await grid(A);
ok(!at(monday, 'core') && at(w1, 'core'), 'removed group disappears from this week but keeps old weeks');
await as(A, `update public.muscle_groups set archived_at = null where id = 'core'`);

// ---------- week start ----------
await as(A, `update public.settings set week_start = 'sunday' where user_id = $1`, [A]);
rows = await grid(A, 2);
const sunday = one(await sys(`select public.week_start_of($1::date, 'sunday')::text as d`, [today])).d;
ok(rows.length > 0 && rows.every(r => new Date(iso(r.week_start) + 'T00:00:00Z').getUTCDay() === 0), 'every week now starts on a Sunday');
ok(rows.some(r => iso(r.week_start) === sunday), 'the current week starts on this Sunday');
const legsNow = rows.find(r => iso(r.week_start) === sunday && r.group_id === 'legs');
ok(legsNow && legsNow.sets === 2, 'today\'s sets stay in the current week after switching');
await as(A, `update public.settings set week_start = 'monday' where user_id = $1`, [A]);

// ---------- steps ----------
await as(A, `insert into public.daily_steps (day, steps) values ($1, 8000), ($2, 12000), ($3, 0), ($4, 15000)`,
  [monday, await shift(monday, 1), await shift(monday, 2), w1]);
await as(A, `insert into public.daily_steps (day, steps) values ($1, 9000) on conflict (user_id, day) do update set steps = excluded.steps, updated_at = now()`, [monday]);
ok(one(await sys(`select steps from public.daily_steps where user_id = $1 and day = $2`, [A, monday])).steps === 9000, 'steps upsert replaces the day');
const steps = (await as(A, `select * from public.weekly_steps(2)`)).rows;
const thisWeek = steps.find(r => iso(r.week_start) === monday);
ok(thisWeek.avg_steps === 10500 && thisWeek.days_logged === 2, 'this week: average of the two days with steps (9,000 and 12,000)');
ok(thisWeek.days_at_goal === 1, 'one day reached the 10,000 step goal');
ok(steps.find(r => iso(r.week_start) === w1).avg_steps === 15000, 'last week has its own average');

// ---------- activity log ----------
const log = (await as(A, `select kind, group_id, old_value, new_value from public.activity_log order by happened_at desc, kind`)).rows;
const kinds = new Set(log.map(r => r.kind));
for (const k of ['set', 'weekly_goal', 'group_target', 'group_added', 'group_removed', 'group_restored', 'week_start']) {
  ok(kinds.has(k), `activity log shows ${k}`);
}
ok(!log.some(r => r.kind === 'weekly_goal' && r.old_value === null && r.new_value === '20'), 'starting values are not listed');

// ---------- privacy between people ----------
await as(B, `update public.settings set onboarded_at = now() where user_id = $1`, [B]);
ok(one(await as(B, `select count(*)::int as n from public.set_entries`)).n === 0, 'B sees none of A\'s sets');
ok(one(await as(B, `select count(*)::int as n from public.muscle_groups`)).n === 0, 'B sees none of A\'s groups');
ok(one(await as(B, `select count(*)::int as n from public.activity_log`)).n === 0, 'B sees none of A\'s activity');
ok((await grid(B)).length === 0, 'B\'s history is empty');
await asFails(B, `insert into public.muscle_groups (user_id, id, name) values ($1, 'legs', 'Legs')`, [A], /row-level security/);
const upd = await as(B, `update public.settings set weekly_goal = 5 where user_id = $1`, [A]);
ok(upd.affectedRows === 0, 'B cannot change A\'s settings');
const del = await as(B, `delete from public.set_entries where user_id = $1`, [A]);
ok(del.affectedRows === 0, 'B cannot delete A\'s sets');
await asFails(B, `insert into public.changes (user_id, kind, new_value, local_date) values ($1, 'weekly_goal', '1', now())`, [B], /row-level security|permission denied/);

await db.exec(`set role anon`);
try {
  await db.query(`select * from public.settings`);
  assert.fail('anon should not read settings');
} catch (e) {
  assert.match(String(e.message), /permission denied/);
  checks++;
} finally {
  await db.exec(`reset role`);
}

// ---------- removing a mistaken set from the log ----------
const mistaken = one(await as(A, `select id from public.set_entries where group_id = 'chest' limit 1`)).id;
await as(A, `delete from public.set_entries where id = $1`, [mistaken]);
rows = await grid(A);
ok(at(monday, 'chest').sets === 0, 'deleting a logged set removes it from the week');

// ---------- account deletion ----------
await as(A, `select public.delete_my_account()`);
for (const t of ['settings', 'muscle_groups', 'set_entries', 'daily_steps', 'changes']) {
  ok(one(await sys(`select count(*)::int as n from public.${t} where user_id = $1`, [A])).n === 0, `A's ${t} deleted`);
}
ok(one(await sys(`select count(*)::int as n from public.settings where user_id = $1`, [B])).n === 1, 'B is untouched');

console.log(`all ${checks} database checks passed`);
