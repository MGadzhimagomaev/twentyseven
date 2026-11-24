// Starting sets of muscle groups, coarse to fine. Ids are shared where groups
// match (Shoulders in Classic is `delts` in Extended), so switching keeps sets.
// Names come in the current language when a bundle is picked; after that they
// are the person's own and stay as saved.
import { t } from './i18n.js';

const bundle = (key, groups) => ({
  key,
  get name() { return t(`bundle.${key}`); },
  get groups() { return groups.map(([id, name]) => [id, t(`group.${name}`)]); },
});

export const BUNDLES = [
  bundle('ppl', [['push', 'push'], ['pull', 'pull'], ['legs', 'legs']]),
  bundle('classic', [['chest', 'chest'], ['back', 'back'], ['delts', 'shoulders'], ['arms', 'arms'], ['legs', 'legs'], ['core', 'core']]),
  bundle('extended', [['legs', 'legs'], ['back', 'back'], ['chest', 'chest'], ['core', 'core'], ['biceps', 'biceps'], ['triceps', 'triceps'], ['delts', 'delts']]),
  bundle('detailed', [
    ['chest', 'chest'], ['back', 'back'], ['front-delts', 'front_delts'], ['side-delts', 'side_delts'],
    ['rear-delts', 'rear_delts'], ['traps', 'traps'], ['biceps', 'biceps'], ['triceps', 'triceps'],
    ['forearms', 'forearms'], ['abs', 'abs'], ['quads', 'quads'], ['hamstrings', 'hamstrings'],
    ['glutes', 'glutes'], ['calves', 'calves'],
  ]),
];

export const bundleByKey = key => BUNDLES.find(b => b.key === key);

// Workouts are counted in sessions, each toward its own weekly target.
const WORKOUT_IDS = ['running', 'cycling', 'swimming', 'gym', 'yoga'];
export const workoutPicks = () => WORKOUT_IDS.map(id => [id, t(`workout.${id}`)]);
export const TRAINING_TARGET = 3;
export const isTraining = g => g?.kind === 'sessions';

// Which bundle a list of groups matches, or 'custom'.
export function matchBundle(groups) {
  for (const b of BUNDLES) {
    // Same groups in the same order; names may be in another language or renamed.
    if (b.groups.length === groups.length && b.groups.every(([id], i) => groups[i].id === id)) {
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
