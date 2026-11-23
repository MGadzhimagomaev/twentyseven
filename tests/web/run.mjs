// Walks through the web app in Chromium against a stand-in backend: sign-in,
// setup, tips, logging and undoing sets, goals, group editing, offline saving,
// past weeks, history, the log, settings, export and account deletion.
//
// usage: node tests/web/run.mjs [folder for screenshots]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { serve } from './server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fakeSrc = readFileSync(new URL('./fake-api.js', import.meta.url), 'utf8');
const shots = process.argv[2];

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

// ---------- the offline file list matches the files ----------
const webDir = new URL('../../web/', import.meta.url).pathname;
const listed = [...readFileSync(path.join(webDir, 'sw.js'), 'utf8').matchAll(/^  '([^']+)',$/gm)].map(m => m[1]);
const walk = dir => readdirSync(dir).flatMap(f => statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]);
const files = walk(webDir).map(f => path.relative(webDir, f)).filter(f => !f.endsWith('.txt') && f !== 'sw.js');
for (const f of files) ok(listed.includes(f) || (f.endsWith('index.html') && listed.includes(path.dirname(f) + '/')), `sw.js caches ${f}`);
for (const f of listed) ok(f === './' || f.endsWith('/') || files.includes(f), `sw.js lists a file that exists: ${f}`);

const { server, url } = await serve();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
await context.addInitScript(fakeSrc);
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Could not save/.test(m.text())) errors.push(m.text()); });

const fake = (fn, arg) => page.evaluate(fn, arg);
const tile = name => page.locator('.cell', { has: page.locator('.cell-label', { hasText: new RegExp(`^${name}$`) }) });
const count = async name => Number(await tile(name).locator('.count .n').textContent());
const target = async name => (await tile(name).locator('.count .of').textContent()).replace('/', '');
const toastText = () => page.locator('.toast-text').textContent();
const saved = () => page.waitForSelector('.sync[data-state="saved"]', { timeout: 5000 });
const db = () => fake(() => window.__fake.db());
const uid = async () => Object.keys((await db()).users)[0];
async function shot(name) {
  if (!shots) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

// ---------- sign-in ----------
await page.goto(url);
await page.waitForSelector('#auth-email');
eq(await page.locator('h1').textContent(), 'Sign in', 'signed-out people see the sign-in screen');
await shot('01-sign-in');
await page.fill('#auth-email', 'blocked@example.com');
await page.click('text=Send sign-in email');
await page.waitForSelector('.form-msg');
ok((await page.locator('.form-msg').textContent()).includes('invite-only'), 'closed sign-ups explain the invite');
await page.fill('#auth-email', 'marat@example.com');
await page.click('text=Send sign-in email');
await page.waitForSelector('#auth-code');
eq(await page.locator('h1').textContent(), 'Check your email', 'code step follows');
ok((await fake(() => window.__fake.sent)).includes('marat@example.com'), 'the email was sent');
await page.reload();
await page.waitForSelector('#auth-code');
ok(true, 'the code step survives a reload (trip to the mail app)');
ok(!/6-digit/.test(await page.locator('.auth-card').textContent()), 'no fixed code length is promised');
await fake(() => { window.__fake.code = '48151623'; });     // an 8-digit code, as Supabase can send
await page.type('#auth-code', '481516');
await page.waitForTimeout(300);
eq(await page.locator('.form-msg').count(), 0, 'typing six digits of a longer code doesn’t send it early');
await page.fill('#auth-code', '87654321');
await page.waitForSelector('.form-msg');
ok((await page.locator('.form-msg').textContent()).includes('wrong or has expired'), 'a pasted wrong code is sent and explained');
await page.fill('#auth-code', '48151623');
await page.waitForSelector('.setup');
ok(true, 'a pasted 8-digit code signs in');

// ---------- setup ----------
eq(await page.locator('h1').textContent(), 'Set up', 'first launch shows setup');
eq(await page.locator('.choice[aria-checked="true"] .choice-name').textContent(), 'Classic · 6', 'Classic is picked by default');
eq(await page.locator('.seg-btn[aria-checked="true"]').textContent(), 'Monday', 'a German locale starts weeks on Monday');
await shot('02-setup');
await page.click('text=Extended · 7');
await page.click('[aria-label="Lower the goal"]');
await page.click('[aria-label="Lower the goal"]');
await page.click('text=Start tracking');
await page.waitForSelector('.grid');
eq(await page.locator('.cell').count(), 7, 'Extended gives seven groups');
eq(await page.locator('.goal .goal-value').textContent(), '18', 'the picked goal is used');
ok(/^Week \d+$/.test(await page.locator('h1').textContent()), 'Monday weeks show their number');
await saved();
let d = await db(), me = await uid();
ok(d.settings[me].onboarded_at && d.settings[me].weekly_goal === 18 && d.settings[me].bundle === 'extended', 'setup saved');
eq(d.changes[me].length, 0, 'setup choices are not logged as changes');

// ---------- the tour ----------
const tourStep = async () => `${await page.locator('.tour-count').textContent()} ${await page.locator('.tour-title').textContent()}`;
await page.waitForSelector('.tour-card');
eq(await tourStep(), '1 of 11 Log a set', 'the tour starts after setup');
await shot('03-tour');
await tile('Legs').locator('.cell-add').click();
eq(await tourStep(), '2 of 11 One too many?', 'logging a real set moves the tour on');
eq(await count('Legs'), 1, 'the tour’s set is a real set');
await page.click('.tour-next');
eq(await tourStep(), '3 of 11 Undo', 'then Undo');
await page.click('.tray-btn.undo');
eq(await count('Legs'), 0, 'Undo works during the tour');
eq(await tourStep(), '4 of 11 This week', 'using Undo moves the tour on');
const seen = [];
const howTo = [];
for (let i = 4; i < 11; i++) {
  await page.click('.tour-next');
  seen.push(await page.locator('.tour-title').textContent());
  if (seen.at(-1) === 'Weekly goal') ok((await page.locator('.tour-text').textContent()).includes('see the next tip'), 'the weekly goal step points to the per-group goal');
  if (seen.at(-1) === 'A goal for one group') howTo.push(await page.locator('.tour-text').textContent());
}
eq(seen.join(', '), 'Weekly goal, A goal for one group, Your groups, Past weeks, Saved everywhere, History, Settings', 'the tour covers every part of the app');
ok(/In Edit groups, tap .* set its number with − and \+, then Save groups/.test(howTo[0]), 'the tour explains how to give a group its own goal');
eq(await page.locator('.tour-next').textContent(), 'Done', 'the last step ends with Done');
await page.click('.tour-next');
eq(await page.locator('.tour-card').count(), 0, 'the tour closes');

// ---------- logging and undo ----------
await tile('Legs').locator('.cell-add').click();
for (let i = 0; i < 3; i++) await tile('Chest').locator('.cell-add').click();
eq(await count('Chest'), 3, 'three taps, three sets');
eq(await toastText(), 'Chest +1', 'each tap says what it did');
await page.click('.toast-btn');
eq(await count('Chest'), 2, 'the toast’s Undo takes back the last set');
ok((await toastText()).startsWith('Undone: Chest +1'), 'undo says what it undid');
await page.keyboard.press('Control+z');
eq(await count('Chest'), 1, 'Ctrl+Z undoes again');
ok((await page.locator('.tray-btn.undo').textContent()).includes('Chest +1'), 'the Undo button names what it will undo');
await page.click('.tray-btn.undo');
eq(await count('Chest'), 0, 'the Undo button undoes too');
await page.click('.tray-btn.undo');
eq(await count('Legs'), 0, 'and keeps going back through earlier actions');
ok(await page.locator('.tray-btn.undo').isDisabled(), 'nothing left to undo');
await saved();
d = await db();
eq(d.entries[me].length, 0, 'undone sets never stay in the database');

// ---------- minus ----------
await tile('Back').locator('.cell-add').click();
await tile('Back').locator('.cell-add').click();
await tile('Back').locator('.cell-sub').click();
eq(await count('Back'), 1, '− takes one set off');
eq(await toastText(), 'Back −1', '− says what it did');
await tile('Back').locator('.cell-sub').click();
ok(await tile('Back').locator('.cell-sub').isDisabled(), '− stops at zero');

// ---------- goal ----------
await page.click('[aria-label="Raise the weekly goal"]');
eq(await page.locator('.goal .goal-value').textContent(), '19', 'the goal goes up');
eq(await toastText(), 'Goal 19', 'the goal change is announced');
await page.click('[aria-label="Raise the weekly goal"]');
await page.click('[aria-label="Raise the weekly goal"]');
eq(await target('Legs'), '21', 'targets follow the goal');
await page.click('.tray-btn.undo');
eq(await page.locator('.goal .goal-value').textContent(), '18', 'quick goal steps undo as one');

// ---------- group editor ----------
await page.click('text=Edit groups');
await page.waitForSelector('dialog.sheet[open] .editor');
await shot('04-editor');
const rowOf = name => page.locator('.erow', { has: page.locator(`input[value="${name}"]`) });
await rowOf('Chest').locator('[aria-label^="Give Chest its own target"]').click();
for (let i = 0; i < 6; i++) await page.click('[aria-label="Lower Chest\'s target"]');
eq(await page.locator('.mini-value').textContent(), '12', 'own target set in the editor');
await rowOf('Delts').locator('input').fill('Shoulders');
await rowOf('Core').locator('[aria-label="Remove Core"]').click();
await page.fill('[aria-label="New group name"]', 'Calves');
await page.click('.add-btn');
await page.click('text=Save groups');
await page.waitForSelector('dialog.sheet', { state: 'detached' });
eq(await toastText(), 'Groups saved', 'saving groups is announced');
eq(await target('Chest'), '12', 'Chest keeps its own target');
eq(await tile('Chest').locator('.own').count(), 1, 'a locked group shows a lock');
ok(await tile('Shoulders').count() === 1 && await tile('Calves').count() === 1 && await tile('Core').count() === 0, 'rename, add and remove applied');
await page.click('[aria-label="Raise the weekly goal"]');
eq(await toastText(), 'Goal 19 · 6 groups follow it, 1 has its own', 'goal change says what moved');
eq(await target('Chest'), '12', 'the goal doesn’t move a locked group');
await saved();
d = await db();
ok(d.groups[me].find(g => g.id === 'core').archived_at && d.groups[me].find(g => g.id === 'delts').name === 'Shoulders', 'groups saved: Core removed, Delts renamed');
await page.click('.tray-btn.undo');
await page.click('.tray-btn.undo');
ok(await tile('Core').count() === 1 && await tile('Calves').count() === 0 && await tile('Delts').count() === 1, 'undo restores the group list');
eq(await target('Chest'), '18', 'and unlocks Chest again');
await saved();
d = await db();
ok(!d.groups[me].find(g => g.id === 'core').archived_at && d.groups[me].find(g => g.id === 'calves').archived_at, 'database matches after undo');

// ---------- offline ----------
await fake(() => { window.__fake.offline = true; });
await tile('Legs').locator('.cell-add').click();
await page.waitForSelector('.sync[data-state="offline"]');
ok((await page.locator('.sync').textContent()).includes('1 change waiting'), 'offline changes wait on the device');
await page.reload();
await page.waitForSelector('.grid');
eq(await count('Legs'), 1, 'a reload while offline keeps the unsaved set');
await fake(() => { window.__fake.offline = false; window.dispatchEvent(new Event('online')); });
await saved();
d = await db();
eq(d.entries[me].filter(e => e.group_id === 'legs').length, 1, 'the waiting set is saved once back online');

// ---------- a past week ----------
const thisWeek = await page.locator('h1').textContent();
await page.click('[aria-label="Previous week"]');
ok((await page.locator('h1').textContent()) !== thisWeek, 'the arrow shows the week before');
ok((await page.locator('.hint').first().textContent()).startsWith('Past week'), 'past weeks say where new sets go');
await tile('Biceps').locator('.cell-add').click();
eq(await count('Biceps'), 1, 'sets can be added to a past week');
await page.click('text=Back to this week');
eq(await count('Biceps'), 0, 'they don’t count for this week');
await saved();
d = await db();
const bi = d.entries[me].find(e => e.group_id === 'biceps');
ok(bi && bi.local_date < (await fake(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })), 'a past-week set is dated in that week');

// Some history to look at: two earlier weeks.
await fake(() => window.__fake.seed((db, id) => {
  const pad = n => String(n).padStart(2, '0');
  const day = n => { const t = new Date(); t.setDate(t.getDate() - n); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const groups = ['legs', 'back', 'chest', 'core', 'biceps', 'triceps', 'delts'];
  const counts = [[20, 16, 12, 9, 14, 18, 21], [12, 20, 8, 15, 6, 10, 16]];
  counts.forEach((week, w) => week.forEach((n, g) => {
    for (let i = 0; i < n; i++) db.entries[id].push({ id: `seed-${w}-${g}-${i}`, group_id: groups[g], delta: 1, local_date: day(7 * (w + 1) + 1), logged_at: new Date(Date.now() - 864e5 * (7 * (w + 1) + 1)).toISOString(), source: w ? 'import' : 'ios' });
  }));
  for (let i = 1; i < 20; i++) db.steps[id].push({ day: day(i), steps: 6000 + ((i * 1371) % 7000) });
  for (const g of db.groups[id]) g.created_at = new Date(Date.now() - 864e5 * 60).toISOString();
}));
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.reload();
await page.waitForSelector('.grid');

// ---------- history ----------
await page.click('.tab[href="#history"]');
await page.waitForSelector('.heat');
eq(await page.locator('.heat-row:not(.heat-head)').count(), 8, 'one row per group in the grid, removed Calves included');
ok(await page.locator('.hc[data-l="5"]').count() > 0, 'weeks at goal are ticked');
ok(await page.locator('.plot svg').count() >= 2, 'sets and steps charts drawn');
await page.locator('.hc[data-l="5"]').first().click();
ok((await page.locator('.heat-note').textContent()).includes('sets'), 'a square shows its count');
await page.click('.heat-name:has-text("Back")');
await page.waitForSelector('text=Back, week by week');
ok(true, 'a group opens its own chart');
await shot('05-history');
await page.click('[role="tab"]:has-text("Log")');
await page.waitForSelector('.log-row');
ok(await page.locator('.log-row.kind-set').count() > 0, 'the log lists sets');
ok(await page.locator('.log-row', { hasText: 'Renamed Delts to Shoulders' }).count() === 1, 'the log lists group changes');
await shot('06-log');
const before = await page.locator('.log-row.kind-set').count();
await page.locator('.log-row.kind-set').first().locator('button').click();
eq(await page.locator('.log-row.kind-set').count(), before - 1, 'a set can be removed from the log');
ok((await toastText()).endsWith('removed'), 'removal is announced');
await page.click('.toast-btn');
await page.waitForFunction(n => document.querySelectorAll('.log-row.kind-set').length === n, before);
ok(true, 'undo puts the removed set back in the log');

// ---------- settings ----------
await page.click('.tab[href="#settings"]');
await page.waitForSelector('.settings');
await page.click('.seg-btn:has-text("Sunday")');
eq(await toastText(), 'Weeks start on Sunday', 'week start change announced');
await page.click('[aria-label="Raise the daily step goal"]');
eq(await toastText(), 'Step goal 10,500', 'step goal changes by 500');
await page.click('[role="switch"]');
await shot('07-settings');
await page.click('text=Show the tour again');
await page.waitForSelector('.tour-card');
eq(await tourStep(), '1 of 11 Log a set', 'the tour can be shown again from Settings');
await page.click('text=Skip tour');
eq(await page.locator('.tour-card').count(), 0, 'and skipped');
await page.click('.tab[href="#settings"]');
await page.waitForSelector('.settings');
await page.click('.tab[href="#sets"]');
await page.waitForSelector('.grid');
ok(/\d/.test(await page.locator('h1').textContent()) && !/^Week/.test(await page.locator('h1').textContent()), 'Sunday weeks show their dates');
ok((await page.locator('.summary').textContent()).includes('Steps/day'), 'steps show on Sets when turned on');
await shot('08-sets');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
ok(/^Week \d+$/.test(await page.locator('h1').textContent()), 'settings changes undo too');

// ---------- export ----------
await page.click('.tab[href="#settings"]');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Sets (CSV)')]);
const csv = readFileSync(await download.path(), 'utf8');
ok(csv.startsWith('date,logged_at,group,change,source'), 'CSV export has a header');
ok(csv.split('\r\n').length > 40, 'CSV export has every set');

// ---------- dark mode ----------
await page.emulateMedia({ colorScheme: 'dark' });
await page.click('.tab[href="#sets"]');
await page.waitForSelector('.grid');
await shot('09-sets-dark');
await page.click('.tab[href="#history"]');
await page.waitForSelector('.heat');
await shot('10-history-dark');
await page.emulateMedia({ colorScheme: 'light' });

// ---------- delete account ----------
await page.click('.tab[href="#settings"]');
await page.click('button.btn.danger:has-text("Delete account")');
await page.waitForSelector('dialog.sheet[open] .confirm');
await page.click('text=Delete everything');
await page.waitForSelector('#auth-email');
d = await db();
ok(!d.users[me] && !d.settings[me], 'deleting the account removes its data');

// ---------- an expired sign-in link ----------
await page.goto('about:blank');
await page.goto(url + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
await page.waitForSelector('.form-msg');
ok((await page.locator('.form-msg').textContent()).includes('expired'), 'an expired link is explained');
ok(!page.url().includes('error'), 'and the address is tidied');

eq(errors.length, 0, `no page errors: ${errors.join(' | ')}`);
await browser.close();
server.close();
console.log(`all ${checks} web checks passed`);
