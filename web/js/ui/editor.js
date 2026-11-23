// Edit groups: muscle groups, counted in sets, and trainings such as runs or gym
// sessions, counted in sessions. Muscle groups follow the weekly goal unless locked
// to their own target; trainings always have their own. Nothing is saved until
// "Save", and Undo takes the whole save back.
import { el, fill, ICON, clamp, plural } from '../util.js';
import { BUNDLES, TRAININGS, TRAINING_TARGET, matchBundle, cleanName, NAME_MAX, GROUPS_MAX } from '../bundles.js';
import { openSheet } from './dialog.js';

export function openEditor({ store, toast, undo }) {
  const goal = store.goal();
  const known = new Map(store.state.groups.map(g => [g.id, g]));
  let draft = store.activeGroups().map(g => ({ id: g.id, name: g.name, kind: g.kind || 'sets', own_target: g.own_target ?? null }));
  let error = '';
  let focusAdd = '';

  const body = el('div', { class: 'editor' });
  const sheet = openSheet(body, { label: 'Edit groups' });

  const muscles = () => draft.filter(d => d.kind !== 'sessions');
  const runs = () => draft.filter(d => d.kind === 'sessions');
  const lower = s => cleanName(s).toLowerCase();

  function pickBundle(b) {
    const own = new Map(muscles().filter(d => d.id).map(d => [d.id, d.own_target]));
    draft = [...b.groups.map(([id, name]) => ({ id, name, kind: 'sets', own_target: own.get(id) ?? null })), ...runs()];
    error = '';
    draw();
  }
  function move(kind, i, by) {
    const m = muscles(), r = runs();
    const list = kind === 'sessions' ? r : m;
    const [row] = list.splice(i, 1);
    list.splice(i + by, 0, row);
    draft = [...m, ...r];
    draw();
  }
  function remove(d) {
    draft = draft.filter(x => x !== d);
    draw();
  }

  // Adds a group or training by name. A removed one of the same kind and name
  // comes back with its history.
  function add(name, kind, id = null) {
    name = cleanName(name);
    if (!name) return false;
    if (draft.length >= GROUPS_MAX) { error = `Up to ${GROUPS_MAX} groups and trainings in all.`; draw(); return false; }
    if (draft.some(d => lower(d.name) === name.toLowerCase())) { error = `“${name}” is already in the list.`; draw(); return false; }
    const back = [...known.values()].find(g => g.archived_at && (g.kind || 'sets') === kind && g.name.toLowerCase() === name.toLowerCase() && !draft.some(d => d.id === g.id));
    const clash = id && known.get(id) && ((known.get(id).kind || 'sets') !== kind || !known.get(id).archived_at);
    const useId = back?.id ?? (clash ? null : id);
    const target = kind === 'sessions' ? (back?.own_target ?? TRAINING_TARGET) : (back?.own_target ?? null);
    draft = kind === 'sessions' ? [...muscles(), ...runs(), { id: useId, name, kind, own_target: target }]
      : [...muscles(), { id: useId, name, kind, own_target: target }, ...runs()];
    error = '';
    focusAdd = kind;
    draw();
    return true;
  }

  function check() {
    if (!draft.length) return 'Keep at least one group or training.';
    const names = draft.map(d => cleanName(d.name));
    if (names.some(n => !n)) return 'Every group and training needs a name.';
    const seen = new Set();
    for (const n of names) {
      if (seen.has(n.toLowerCase())) return `“${n}” is in the list twice.`;
      seen.add(n.toLowerCase());
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

  function stepper(d, label, min = 1) {
    const set = n => { d.own_target = clamp(n, min, 50); draw(); };
    return [
      el('button', { type: 'button', class: 'mini', 'aria-label': `Lower ${label}`, html: ICON.minus, disabled: d.own_target <= min, onclick: () => set(d.own_target - 1) }),
      el('output', { class: 'mini-value', text: d.own_target }),
      el('button', { type: 'button', class: 'mini', 'aria-label': `Raise ${label}`, html: ICON.plus, disabled: d.own_target >= 50, onclick: () => set(d.own_target + 1) }),
    ];
  }

  function nameField(d, i, what) {
    return el('input', {
      class: 'field', type: 'text', value: d.name, maxlength: String(NAME_MAX), spellcheck: 'false',
      'aria-label': `${what} ${i + 1} name`, oninput: e => { d.name = e.target.value; },
    });
  }
  const moveButtons = (d, i, n, kind) => [
    el('button', { type: 'button', class: 'ibtn', 'aria-label': `Move ${d.name} up`, html: ICON.up, disabled: i === 0, onclick: () => move(kind, i, -1) }),
    el('button', { type: 'button', class: 'ibtn', 'aria-label': `Move ${d.name} down`, html: ICON.down, disabled: i === n - 1, onclick: () => move(kind, i, 1) }),
    el('button', { type: 'button', class: 'ibtn', 'aria-label': `Remove ${d.name}`, html: ICON.remove, disabled: draft.length === 1, onclick: () => remove(d) }),
  ];

  function muscleRow(d, i, n) {
    const locked = d.own_target != null;
    const old = d.id && known.get(d.id);
    return el('li', { class: 'erow' },
      el('div', { class: 'erow-main' },
        nameField(d, i, 'Group'),
        locked
          ? el('div', { class: 'own-target' }, el('span', { class: 'erow-sub', text: 'Own target' }), ...stepper(d, `${d.name}'s target`))
          : el('p', { class: 'erow-sub', text: old?.archived_at ? `Back, with its old sets · follows the goal (${goal})` : `Follows the goal (${goal})` })),
      el('button', {
        type: 'button', class: locked ? 'ibtn on' : 'ibtn', 'aria-pressed': String(locked), html: locked ? ICON.lock : ICON.unlock,
        'aria-label': locked ? `${d.name || 'This group'} has its own target. Let it follow the goal` : `Give ${d.name || 'this group'} its own target`,
        onclick: () => { d.own_target = locked ? null : goal; draw(); },
      }),
      ...moveButtons(d, i, n, 'sets'));
  }

  function trainingRow(d, i, n) {
    return el('li', { class: 'erow runs' },
      el('div', { class: 'erow-main' },
        nameField(d, i, 'Training'),
        el('div', { class: 'own-target' }, el('span', { class: 'erow-sub', text: 'Times a week' }), ...stepper(d, `${d.name}'s weekly target`))),
      ...moveButtons(d, i, n, 'sessions'));
  }

  function addForm(kind, placeholder) {
    const input = el('input', { class: 'field', type: 'text', maxlength: String(NAME_MAX), placeholder, 'aria-label': kind === 'sessions' ? 'New training name' : 'New group name', spellcheck: 'false' });
    if (focusAdd === kind) queueMicrotask(() => { input.focus(); focusAdd = ''; });
    return el('form', {
      class: 'ed-add', autocomplete: 'off',
      onsubmit: e => { e.preventDefault(); add(input.value, kind); },
    }, input, el('button', { type: 'submit', class: 'add-btn', html: ICON.plus }, 'Add'));
  }

  function draw() {
    const m = muscles(), r = runs();
    const current = matchBundle(m.map(d => ({ id: d.id, name: cleanName(d.name) })));
    const anyLocked = m.some(d => d.own_target != null);
    const picks = TRAININGS.filter(([id, name]) => !draft.some(d => d.id === id || lower(d.name) === name.toLowerCase()));

    fill(body,
      el('div', { class: 'ed-head' },
        el('div', { class: 'ed-head-row' },
          el('h2', { class: 'sheet-title', text: 'Edit groups' }),
          el('span', { class: 'ed-count', text: [m.length ? plural(m.length, 'group', 'groups') : '', r.length ? plural(r.length, 'training', 'trainings') : ''].filter(Boolean).join(' · ') || 'Empty' })),
        el('p', { class: 'ed-note', text: 'Rename, reorder, add or remove. Removed ones keep their history.' })),

      el('section', { class: 'ed-section', 'aria-labelledby': 'ed-muscles' },
        el('div', { class: 'ed-section-head' },
          el('h3', { class: 'ed-section-title', id: 'ed-muscles', text: 'Muscle groups' }),
          el('p', { class: 'ed-note', text: 'Counted in sets. They follow the weekly goal, unless you tap the lock to give one its own target.' })),
        el('div', { class: 'ed-presets', role: 'group', 'aria-label': 'Start from a bundle' },
          el('span', { class: 'label', text: 'Start from' }),
          el('div', { class: 'chips' }, ...BUNDLES.map(b => el('button', {
            type: 'button', class: 'chip', 'aria-current': String(current === b.key), html: ICON.tick, onclick: () => pickBundle(b),
          }, b.name, el('span', { class: 'chip-n', text: b.groups.length }))))),
        m.length ? el('ol', { class: 'ed-list' }, ...m.map((d, i) => muscleRow(d, i, m.length))) : el('p', { class: 'ed-empty', text: 'No muscle groups. Pick a bundle or add one.' }),
        addForm('sets', 'Add a group, e.g. Forearms'),
        anyLocked ? el('div', { class: 'ed-unlock' },
          el('button', { type: 'button', class: 'link-btn', text: 'Unlock all', onclick: () => { for (const d of m) d.own_target = null; draw(); } }),
          el('span', { class: 'muted small', text: 'Every muscle group follows the weekly goal again.' })) : null),

      el('section', { class: 'ed-section', 'aria-labelledby': 'ed-trainings' },
        el('div', { class: 'ed-section-head' },
          el('h3', { class: 'ed-section-title', id: 'ed-trainings', text: 'Trainings' }),
          el('p', { class: 'ed-note', text: 'Runs, rides, gym sessions: anything you count per week. Each has its own weekly target and adds up apart from your sets.' })),
        picks.length ? el('div', { class: 'ed-presets', role: 'group', 'aria-label': 'Quick picks' },
          el('span', { class: 'label', text: 'Add' }),
          el('div', { class: 'chips' }, ...picks.map(([id, name]) => el('button', {
            type: 'button', class: 'chip', html: ICON.plus, onclick: () => add(name, 'sessions', id),
          }, name)))) : null,
        r.length ? el('ol', { class: 'ed-list' }, ...r.map((d, i) => trainingRow(d, i, r.length))) : null,
        addForm('sessions', 'Add a training, e.g. Climbing')),

      error ? el('p', { class: 'ed-error', role: 'alert', text: error }) : null,
      el('div', { class: 'tray' },
        el('button', { type: 'button', class: 'tray-btn', text: 'Cancel', onclick: () => sheet.close() }),
        el('button', { type: 'button', class: 'tray-btn primary', text: 'Save groups', onclick: save })));
  }

  draw();
}
