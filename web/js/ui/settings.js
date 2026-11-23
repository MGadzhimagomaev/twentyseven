// Settings: training, steps, tips, your data and your account.
import { el, ICON, clamp, number, isoDate, plural } from '../util.js';
import { bundleByKey } from '../bundles.js';
import { APP_VERSION } from '../config.js';
import { openEditor } from './editor.js';
import { confirmSheet } from './dialog.js';
import { classify } from '../api.js';

const DAY_NAME = { monday: 'Monday', sunday: 'Sunday' };

function csvCell(v, text = false) {
  let s = String(v ?? '');
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // spreadsheets must not run it as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function setsCSV(data) {
  const names = new Map(data.groups.map(g => [g.id, g.name]));
  const rows = [['date', 'logged_at', 'group', 'change', 'source'].join(',')];
  for (const e of data.sets) {
    rows.push([csvCell(e.local_date), csvCell(e.logged_at), csvCell(names.get(e.group_id) ?? e.group_id, true), csvCell(e.delta), csvCell(e.source)].join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function settingsView(ctx) {
  const { store, toast, undo, go } = ctx;
  const root = el('main', { class: 'page settings' });
  let busy = '';

  function change(field, value, label) {
    store.setSetting(field, value, label);
    toast(label, { action: 'Undo', onAction: undo });
  }

  function stepper(value, { min, max, step, label, onchange, format = String }) {
    return el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'step', 'aria-label': `Lower the ${label}`, html: ICON.minus, disabled: value <= min, onclick: () => onchange(clamp(value - step, min, max)) }),
      el('output', { class: 'goal-value small', 'aria-live': 'polite', text: format(value) }),
      el('button', { type: 'button', class: 'step', 'aria-label': `Raise the ${label}`, html: ICON.plus, disabled: value >= max, onclick: () => onchange(clamp(value + step, min, max)) }));
  }

  const row = (title, note, control) => el('div', { class: 'srow' },
    el('div', { class: 'srow-text' }, el('p', { class: 'srow-title', text: title }), note ? el('p', { class: 'srow-note', text: note }) : null),
    control);

  async function exportAs(kind) {
    if (busy) return;
    busy = kind; draw();
    try {
      const data = await store.exportData();
      const day = isoDate();
      if (kind === 'csv') download(`20-7-sets-${day}.csv`, setsCSV(data), 'text/csv;charset=utf-8');
      else download(`20-7-export-${day}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2), 'application/json');
    } catch (e) {
      toast(classify(e).kind === 'network' ? 'Exporting needs a connection.' : 'Export failed. Try again.');
    }
    busy = ''; draw();
  }

  async function signOut() {
    const n = store.state.pending.length;
    if (n) {
      const yes = await confirmSheet({
        title: 'Sign out?', confirm: 'Sign out anyway', danger: true,
        text: `${plural(n, 'change hasn’t', 'changes haven’t')} been saved yet. Signing out now loses ${n === 1 ? 'it' : 'them'}.`,
      });
      if (!yes) return;
    }
    await store.signOut();
  }

  async function deleteAccount() {
    const yes = await confirmSheet({
      title: 'Delete your account?', confirm: 'Delete everything', danger: true,
      text: 'This deletes your account and every set, step count and setting in it, right away. It can’t be undone. Export first if you want a copy.',
    });
    if (!yes) return;
    try {
      await store.deleteAccount();
    } catch (e) {
      toast(classify(e).kind === 'network' ? 'Deleting needs a connection.' : 'Couldn’t delete the account. Try again.');
    }
  }

  function draw() {
    const s = store.state;
    if (!s.settings) return;
    const st = s.settings;
    const groups = store.activeGroups();
    const bundle = bundleByKey(st.bundle);

    root.replaceChildren(
      el('header', { class: 'top' }, el('div', { class: 'week' }, el('p', { class: 'brand', text: '20/7' }), el('h1', { text: 'Settings' }))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-training' },
        el('h2', { class: 'panel-title', id: 'set-training', text: 'Training' }),
        row('Weekly goal', 'Sets per group, each week. Groups with their own target keep it.',
          stepper(st.weekly_goal, { min: 1, max: 50, step: 1, label: 'weekly goal', onchange: v => change('weekly_goal', v, `Goal ${v}`) })),
        row('Weeks start on', 'Counts go back to zero at 00:00 that day.',
          el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Weeks start on' },
            ...['monday', 'sunday'].map(d => el('button', {
              type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(st.week_start === d), text: DAY_NAME[d],
              onclick: () => change('week_start', d, `Weeks start on ${DAY_NAME[d]}`),
            })))),
        row('Muscle groups', `${bundle ? bundle.name : 'Your own'} · ${plural(groups.length, 'group', 'groups')}`,
          el('button', { type: 'button', class: 'btn', html: ICON.edit, onclick: () => openEditor(ctx) }, 'Edit groups'))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-steps' },
        el('h2', { class: 'panel-title', id: 'set-steps', text: 'Steps' }),
        row('Daily step goal', null,
          stepper(st.step_goal, { min: 1000, max: 50000, step: 500, label: 'daily step goal', format: number, onchange: v => change('step_goal', v, `Step goal ${number(v)}`) })),
        row('Show steps on the Sets screen', 'This week’s average per day. Steps come from the iPhone app, so they show once it has synced.',
          el('button', {
            type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(!!st.show_steps_on_sets), 'aria-label': 'Show steps on the Sets screen',
            onclick: () => change('show_steps_on_sets', !st.show_steps_on_sets, st.show_steps_on_sets ? 'Steps hidden on Sets' : 'Steps shown on Sets'),
          }, el('span', { class: 'switch-knob' })))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-help' },
        el('h2', { class: 'panel-title', id: 'set-help', text: 'Help' }),
        row('Tour', 'A quick walk through the Sets screen, as on your first launch.',
          el('button', { type: 'button', class: 'btn', text: 'Show the tour again', onclick: () => { store.setShowTips(true); go('sets'); } }))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-data' },
        el('h2', { class: 'panel-title', id: 'set-data', text: 'Your data' }),
        row('Export', 'Every set as a spreadsheet, or everything as JSON. Keep a copy now and then: the free database has no backups.',
          el('div', { class: 'btn-row' },
            el('button', { type: 'button', class: 'btn', disabled: !!busy, text: busy === 'csv' ? 'Preparing…' : 'Sets (CSV)', onclick: () => exportAs('csv') }),
            el('button', { type: 'button', class: 'btn', disabled: !!busy, text: busy === 'json' ? 'Preparing…' : 'All (JSON)', onclick: () => exportAs('json') })))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-account' },
        el('h2', { class: 'panel-title', id: 'set-account', text: 'Account' }),
        row('Signed in as', s.user?.email || '', el('button', { type: 'button', class: 'btn', text: 'Sign out', onclick: signOut })),
        row('Delete account', 'Removes your account and all its data for good.',
          el('button', { type: 'button', class: 'btn danger', text: 'Delete account', onclick: deleteAccount }))),

      el('footer', { class: 'foot about' },
        el('a', { href: './privacy/', text: 'Privacy policy' }),
        el('span', { text: `20/7 · version ${APP_VERSION}` })));
  }

  return { el: root, update: draw };
}
