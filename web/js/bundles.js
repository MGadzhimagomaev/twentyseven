// Starting sets of muscle groups, coarse to fine. Ids are shared where groups
// match (Shoulders in Classic is `delts` in Extended), so switching keeps sets.
export const BUNDLES = [
  {
    key: 'ppl',
    name: 'Push / Pull / Legs',
    note: 'For a push, pull, legs split',
    groups: [['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs']],
  },
  {
    key: 'classic',
    name: 'Classic',
    note: 'The major muscle groups',
    groups: [['chest', 'Chest'], ['back', 'Back'], ['delts', 'Shoulders'], ['arms', 'Arms'], ['legs', 'Legs'], ['core', 'Core']],
  },
  {
    key: 'extended',
    name: 'Extended',
    note: 'Classic with arms split in two',
    groups: [['legs', 'Legs'], ['back', 'Back'], ['chest', 'Chest'], ['core', 'Core'], ['biceps', 'Biceps'], ['triceps', 'Triceps'], ['delts', 'Delts']],
  },
  {
    key: 'detailed',
    name: 'Detailed',
    note: 'Delts and legs split into parts',
    groups: [
      ['chest', 'Chest'], ['back', 'Back'], ['front-delts', 'Front delts'], ['side-delts', 'Side delts'],
      ['rear-delts', 'Rear delts'], ['traps', 'Traps'], ['biceps', 'Biceps'], ['triceps', 'Triceps'],
      ['forearms', 'Forearms'], ['abs', 'Abs'], ['quads', 'Quads'], ['hamstrings', 'Hamstrings'],
      ['glutes', 'Glutes'], ['calves', 'Calves'],
    ],
  },
];

export const bundleByKey = key => BUNDLES.find(b => b.key === key);

// Trainings are counted in sessions, each toward its own weekly target.
export const TRAININGS = [['running', 'Running'], ['cycling', 'Cycling'], ['swimming', 'Swimming'], ['gym', 'Gym'], ['yoga', 'Yoga']];
export const TRAINING_TARGET = 3;
export const isTraining = g => g?.kind === 'sessions';

// Which bundle a list of groups matches exactly, or 'custom'.
export function matchBundle(groups) {
  for (const b of BUNDLES) {
    if (b.groups.length === groups.length && b.groups.every(([id, name], i) => groups[i].id === id && groups[i].name === name)) {
      return b.key;
    }
  }
  return 'custom';
}

export const NAME_MAX = 24;
export const GROUPS_MAX = 30;

export const cleanName = s => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function slugOf(name) {
  return cleanName(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '');
}

// A new group's id comes from its name, so a removed group added back under the
// same name finds its logged sets again. Renaming keeps the id.
export function idFor(name, taken) {
  const base = slugOf(name) || 'g' + hashStr(cleanName(name).toLowerCase()).toString(36);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export const seedOf = id => (hashStr(id) % 99991) + 1;
