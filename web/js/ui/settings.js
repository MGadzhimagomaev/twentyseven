// Settings: training, steps, tips, your data and your account.
import { el, ICON, clamp, number, isoDate, selectBox } from '../util.js';
import { t, LANGUAGES, language, setLanguage } from '../i18n.js';
import { bundleByKey } from '../bundles.js';
import { APP_VERSION } from '../config.js';
import { openEditor } from './editor.js';
import { confirmSheet, openSheet } from './dialog.js';
import { classify } from '../api.js';

function csvCell(v, text = false) {
  let s = String(v ?? '');
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // spreadsheets must not run it as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function setsCSV(data) {
  const names = new Map(data.groups.map(g => [g.id, g.name]));
  const kinds = new Map(data.groups.map(g => [g.id, g.kind === 'sessions' ? 'workout' : 'muscle group']));
  const rows = [['date', 'logged_at', 'name', 'type', 'change', 'source'].join(',')];
  for (const e of data.sets) {
    rows.push([csvCell(e.local_date), csvCell(e.logged_at), csvCell(names.get(e.group_id) ?? e.group_id, true), csvCell(kinds.get(e.group_id) ?? 'muscle group'), csvCell(e.delta), csvCell(e.source)].join(','));
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
    toast(label, { action: t('common.undo'), onAction: undo });
  }

  function stepper(value, { min, max, step, lower, raise, onchange, format = String }) {
    return el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'step', 'aria-label': lower, html: ICON.minus, disabled: value <= min, onclick: () => onchange(clamp(value - step, min, max)) }),
      el('output', { class: 'goal-value small', 'aria-live': 'polite', text: format(value) }),
      el('button', { type: 'button', class: 'step', 'aria-label': raise, html: ICON.plus, disabled: value >= max, onclick: () => onchange(clamp(value + step, min, max)) }));
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
      toast(t(classify(e).kind === 'network' ? 'settings.export_offline' : 'settings.export_failed'));
    }
    busy = ''; draw();
  }

  async function signOut() {
    const n = store.state.pending.length;
    if (n) {
      const yes = await confirmSheet({
        title: t('settings.signout_title'), confirm: t('settings.signout_anyway'), danger: true,
        text: t('settings.signout_text', { n }),
      });
      if (!yes) return;
    }
    await store.signOut();
  }

  function openFeedback() {
    let busy = false;
    const area = el('textarea', {
      class: 'input area', rows: '6', maxlength: '4000', 'aria-label': t('settings.feedback_label'),
      placeholder: t('settings.feedback_placeholder'),
    });
    const msg = el('p', { class: 'form-msg', role: 'alert' });
    const send = el('button', { type: 'submit', class: 'btn primary', text: t('settings.feedback_send') });
    const form = el('form', {
      class: 'confirm',
      onsubmit: async e => {
        e.preventDefault();
        const text = area.value.trim();
        if (!text) { msg.textContent = t('settings.feedback_empty'); return; }
        if (busy) return;
        busy = true; send.disabled = true; send.textContent = t('settings.feedback_sending'); msg.textContent = '';
        try {
          await store.sendFeedback(text, 'settings');
          sheet.close();
          toast(t('settings.feedback_sent'));
        } catch (err) {
          busy = false; send.disabled = false; send.textContent = t('settings.feedback_send');
          msg.textContent = t(classify(err).kind === 'network' ? 'settings.feedback_offline' : 'settings.feedback_failed');
        }
      },
    },
    el('h2', { class: 'sheet-title', text: t('settings.feedback_title') }),
    el('p', { class: 'sheet-text', text: t('settings.feedback_text') }),
    area, msg,
    el('div', { class: 'sheet-actions' },
      el('button', { type: 'button', class: 'btn', text: t('common.cancel'), onclick: () => sheet.close() }),
      send));
    const sheet = openSheet(form, { label: t('settings.feedback_title') });
    area.focus();
  }

  async function deleteAccount() {
    const yes = await confirmSheet({
      title: t('settings.delete_title'), confirm: t('settings.delete_confirm'), danger: true,
      text: t('settings.delete_text'),
    });
    if (!yes) return;
    try {
      await store.deleteAccount();
    } catch (e) {
      toast(t(classify(e).kind === 'network' ? 'settings.delete_offline' : 'settings.delete_failed'));
    }
  }

  function draw() {
    const s = store.state;
    if (!s.settings) return;
    const st = s.settings;
    const groups = store.muscleGroups(), trainings = store.trainings();
    const bundle = bundleByKey(st.bundle);

    const day = d => t(`day.${d}`);
    const groupsNote = [
      groups.length ? `${bundle ? bundle.name : t('settings.your_own')} · ${t('settings.n_groups', { n: groups.length })}` : t('settings.no_groups'),
      trainings.length ? t('settings.n_workouts', { n: trainings.length }) : '',
    ].filter(Boolean).join(' · ');
    const languages = el('select', {
      class: 'select', 'aria-label': t('settings.language'),
      onchange: e => setLanguage(e.target.value),
    }, ...LANGUAGES.map(([code, name]) => el('option', { value: code, selected: code === language(), lang: code, text: name })));

    root.replaceChildren(
      el('header', { class: 'top' }, el('div', { class: 'week' }, el('p', { class: 'brand', text: '20/7' }), el('h1', { text: t('settings.title') }))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-training' },
        el('h2', { class: 'panel-title', id: 'set-training', text: t('settings.training') }),
        row(t('sets.weekly_goal'), t('settings.goal_note'),
          stepper(st.weekly_goal, {
            min: 1, max: 50, step: 1, lower: t('sets.lower_goal'), raise: t('sets.raise_goal'),
            onchange: v => change('weekly_goal', v, t('undo.goal', { n: v })),
          })),
        row(t('settings.week_start'), t('settings.week_start_note'),
          el('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('settings.week_start') },
            ...['monday', 'sunday'].map(d => el('button', {
              type: 'button', role: 'radio', class: 'seg-btn', 'aria-checked': String(st.week_start === d), text: day(d),
              onclick: () => change('week_start', d, t(`settings.starts_${d}`)),
            })))),
        row(t('settings.groups'), groupsNote,
          el('button', { type: 'button', class: 'btn', html: ICON.edit, onclick: () => openEditor(ctx) }, t('sets.edit_groups')))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-steps' },
        el('h2', { class: 'panel-title', id: 'set-steps', text: t('settings.steps') }),
        row(t('settings.step_goal'), null,
          stepper(st.step_goal, {
            min: 1000, max: 50000, step: 500, lower: t('settings.lower_steps'), raise: t('settings.raise_steps'), format: number,
            onchange: v => change('step_goal', v, t('settings.step_goal_toast', { steps: number(v) })),
          })),
        row(t('settings.show_steps'), t('settings.show_steps_note'),
          el('button', {
            type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(!!st.show_steps_on_sets), 'aria-label': t('settings.show_steps'),
            onclick: () => change('show_steps_on_sets', !st.show_steps_on_sets, t(st.show_steps_on_sets ? 'settings.steps_hidden' : 'settings.steps_shown')),
          }, el('span', { class: 'switch-knob' })))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-general' },
        el('h2', { class: 'panel-title', id: 'set-general', text: t('settings.general') }),
        row(t('settings.language'), t('settings.language_note'), selectBox(languages))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-help' },
        el('h2', { class: 'panel-title', id: 'set-help', text: t('settings.help') }),
        row(t('settings.feedback'), t('settings.feedback_note'),
          el('button', { type: 'button', class: 'btn', html: ICON.message, onclick: openFeedback }, t('settings.feedback_title'))),
        row(t('settings.tour'), t('settings.tour_note'),
          el('button', { type: 'button', class: 'btn', text: t('settings.tour_again'), onclick: () => { store.setShowTips(true); go('sets'); } }))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-data' },
        el('h2', { class: 'panel-title', id: 'set-data', text: t('settings.data') }),
        row(t('settings.export'), t('settings.export_note'),
          el('div', { class: 'btn-row' },
            el('button', { type: 'button', class: 'btn', disabled: !!busy, text: busy === 'csv' ? t('settings.preparing') : t('settings.export_csv'), onclick: () => exportAs('csv') }),
            el('button', { type: 'button', class: 'btn', disabled: !!busy, text: busy === 'json' ? t('settings.preparing') : t('settings.export_json'), onclick: () => exportAs('json') })))),

      el('section', { class: 'board panel', 'aria-labelledby': 'set-account' },
        el('h2', { class: 'panel-title', id: 'set-account', text: t('settings.account') }),
        row(t('settings.signed_in_as'), s.user?.email || '', el('button', { type: 'button', class: 'btn', text: t('settings.sign_out'), onclick: signOut })),
        row(t('settings.delete_account'), t('settings.delete_note'),
          el('button', { type: 'button', class: 'btn danger', text: t('settings.delete_account'), onclick: deleteAccount }))),

      el('footer', { class: 'foot about' },
        el('a', { href: './privacy/', text: t('settings.privacy') }),
        el('span', { text: t('settings.version', { v: APP_VERSION }) })));
  }

  return { el: root, update: draw };
}
