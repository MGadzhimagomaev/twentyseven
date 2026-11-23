// Edit groups: start from a bundle, rename, reorder, add, remove, and lock a group
// to its own target so the weekly goal no longer moves it. Nothing is saved until
// "Save groups", and Undo takes the whole save back.
import { el, fill, ICON, clamp, plural } from '../util.js';
import { BUNDLES, matchBundle, cleanName, NAME_MAX, GROUPS_MAX } from '../bundles.js';
import { openSheet } from './dialog.js';

export function openEditor({ store, toast, undo }) {
  const goal = store.goal();
  const known = new Map(store.state.groups.map(g => [g.id, g]));
  let draft = store.activeGroups().map(g => ({ id: g.id, name: g.name, own_target: g.own_target ?? null }));
  let error = '';
  let focusNew = false;

  const body = el('div', { class: 'editor' });
  const sheet = openSheet(body, { label: 'Muscle groups' });

  function pickBundle(b) {
    const own = new Map(draft.filter(d => d.id).map(d => [d.id, d.own_target]));
    draft = b.groups.map(([id, name]) => ({ id, name, own_target: own.get(id) ?? null }));
    error = '';
    draw();
  }
  function move(i, by) {
    const [row] = draft.splice(i, 1);
    draft.splice(i + by, 0, row);
    draw();
  }

  function check() {
    const names = draft.map(d => cleanName(d.name));
    if (!draft.length) return 'Keep at least one group.';
    if (names.some(n => !n)) return 'Every group needs a name.';
    const seen = new Set();
    for (const n of names) {
      const k = n.toLowerCase();
      if (seen.has(k)) return `“${n}” is in the list twice.`;
      seen.add(k);
    }
    return '';
  }

  function save() {
    error = check();
    if (error) { draw(); return; }
    const changed = store.saveGroupList(draft.map(d => ({ ...d, name: cleanName(d.name) })), 'Group changes');
    sheet.close();
    if (changed) toast('Groups saved', { action: 'Undo', onAction: undo });
  }

  function targetRow(d) {
    const set = n => { d.own_target = clamp(n, 1, 50); draw(); };
    return el('div', { class: 'own-target' },
      el('span', { class: 'erow-sub', text: 'Own target' }),
      el('button', { type: 'button', class: 'mini', 'aria-label': `Lower ${d.name}'s target`, html: ICON.minus, disabled: d.own_target <= 1, onclick: () => set(d.own_target - 1) }),
      el('output', { class: 'mini-value', text: d.own_target }),
      el('button', { type: 'button', class: 'mini', 'aria-label': `Raise ${d.name}'s target`, html: ICON.plus, disabled: d.own_target >= 50, onclick: () => set(d.own_target + 1) }));
  }

  function row(d, i) {
    const locked = d.own_target != null;
    const old = d.id && known.get(d.id);
    const field = el('input', {
      class: 'field', type: 'text', value: d.name, maxlength: String(NAME_MAX), spellcheck: 'false',
      'aria-label': `Group ${i + 1} name`, oninput: e => { d.name = e.target.value; },
    });
    if (focusNew && i === draft.length - 1) queueMicrotask(() => field.focus());
    return el('li', { class: 'erow' },
      el('div', { class: 'erow-main' },
        field,
        locked ? targetRow(d)
          : el('p', { class: 'erow-sub', text: old?.archived_at ? `Back, with its old sets · follows the goal (${goal})` : `Follows the goal (${goal})` })),
      el('button', {
        type: 'button', class: locked ? 'ibtn on' : 'ibtn', 'aria-pressed': String(locked), html: locked ? ICON.lock : ICON.unlock,
        'aria-label': locked ? `${d.name || 'This group'} has its own target. Let it follow the goal` : `Give ${d.name || 'this group'} its own target`,
        onclick: () => { d.own_target = locked ? null : goal; draw(); },
      }),
      el('button', { type: 'button', class: 'ibtn', 'aria-label': `Move ${d.name} up`, html: ICON.up, disabled: i === 0, onclick: () => move(i, -1) }),
      el('button', { type: 'button', class: 'ibtn', 'aria-label': `Move ${d.name} down`, html: ICON.down, disabled: i === draft.length - 1, onclick: () => move(i, 1) }),
      el('button', { type: 'button', class: 'ibtn', 'aria-label': `Remove ${d.name}`, html: ICON.remove, disabled: draft.length === 1, onclick: () => { draft.splice(i, 1); draw(); } }));
  }

  function draw() {
    const current = matchBundle(draft.map(d => ({ id: d.id, name: cleanName(d.name) })));
    const anyLocked = draft.some(d => d.own_target != null);
    const input = el('input', {
      class: 'field', type: 'text', maxlength: String(NAME_MAX), placeholder: 'Add a group, e.g. Forearms',
      'aria-label': 'New group name', spellcheck: 'false',
    });
    const addForm = el('form', {
      class: 'ed-add', autocomplete: 'off',
      onsubmit: e => {
        e.preventDefault();
        const name = cleanName(input.value);
        if (!name) return;
        if (draft.length >= GROUPS_MAX) { error = `Up to ${GROUPS_MAX} groups.`; draw(); return; }
        if (draft.some(d => cleanName(d.name).toLowerCase() === name.toLowerCase())) { error = `“${name}” is already in the list.`; draw(); return; }
        // A removed group with this name comes back with its sets.
        const back = [...known.values()].find(g => g.archived_at && g.name.toLowerCase() === name.toLowerCase() && !draft.some(d => d.id === g.id));
        draft.push({ id: back?.id ?? null, name, own_target: back?.own_target ?? null });
        error = '';
        focusNew = false;
        draw();
        const again = body.querySelector('.ed-add .field');
        again?.focus();
      },
    }, input, el('button', { type: 'submit', class: 'add-btn', html: ICON.plus }, 'Add'));

    fill(body,
      el('div', { class: 'ed-head' },
        el('div', { class: 'ed-head-row' },
          el('h2', { class: 'sheet-title', text: 'Muscle groups' }),
          el('span', { class: 'ed-count', text: plural(draft.length, 'group', 'groups') })),
        el('p', { class: 'ed-note', text: 'Rename, reorder, add or remove. Removed groups keep their sets. The lock gives a group its own target, so the weekly goal no longer changes it.' })),
      el('div', { class: 'ed-presets', role: 'group', 'aria-label': 'Start from a bundle' },
        el('span', { class: 'label', text: 'Start from' }),
        el('div', { class: 'chips' }, ...BUNDLES.map(b => el('button', {
          type: 'button', class: 'chip', 'aria-current': String(current === b.key), html: ICON.tick, onclick: () => pickBundle(b),
        }, b.name, el('span', { class: 'chip-n', text: b.groups.length }))))),
      el('ol', { class: 'ed-list' }, ...draft.map(row)),
      addForm,
      anyLocked ? el('div', { class: 'ed-unlock' },
        el('button', { type: 'button', class: 'link-btn', text: 'Unlock all', onclick: () => { for (const d of draft) d.own_target = null; draw(); } }),
        el('span', { class: 'muted small', text: 'Every group follows the weekly goal again.' })) : null,
      error ? el('p', { class: 'ed-error', role: 'alert', text: error }) : null,
      el('div', { class: 'tray' },
        el('button', { type: 'button', class: 'tray-btn', text: 'Cancel', onclick: () => sheet.close() }),
        el('button', { type: 'button', class: 'tray-btn primary', text: 'Save groups', onclick: save })));
  }

  draw();
}
