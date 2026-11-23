// First launch: which muscle groups and trainings to count, which day weeks start,
// and the weekly goal. Each has a choice made already, so "Start tracking" works
// straight away.
import { el, fill, ICON, clamp, timeZone } from '../util.js';
import { BUNDLES, TRAININGS, TRAINING_TARGET } from '../bundles.js';

// Sunday for places whose calendars start the week on Sunday, Monday otherwise.
// Europe and Australia start on Monday even when the browser speaks US English,
// so the time zone settles it there before the language is asked.
export function localWeekStart() {
  if (/^(Europe|Australia)\//.test(timeZone()) || timeZone() === 'Pacific/Auckland') return 'monday';
  try {
    const loc = new Intl.Locale(navigator.language || 'en-GB');
    const info = loc.getWeekInfo?.() || loc.weekInfo;
    if (info?.firstDay === 7) return 'sunday';
  } catch { /* older browsers */ }
  return 'monday';
}

export function setupView({ store }) {
  let bundle = 'classic';            // or 'none' for trainings only
  let weekStart = localWeekStart();
  let goal = 20;
  const picked = new Map();          // training id -> times a week
  let message = '';

  const root = el('main', { class: 'page setup' });

  function radio(label, checked, onpick, ...children) {
    return el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(checked), class: 'choice',
      onclick: () => { onpick(); message = ''; draw(); },
    }, el('span', { class: 'choice-dot', 'aria-hidden': 'true' }), el('span', { class: 'choice-body' }, el('span', { class: 'choice-name', text: label }), ...children));
  }

  function start() {
    if (bundle === 'none' && !picked.size) {
      message = 'Pick muscle groups or at least one workout.';
      draw();
      return;
    }
    const trainings = TRAININGS.filter(([id]) => picked.has(id)).map(([id, name]) => ({ id, name, own_target: picked.get(id) }));
    store.completeSetup({ bundle, weekStart, goal, trainings });
  }

  function draw() {
    const sets = bundle !== 'none';
    let n = 0;
    const num = () => el('span', { class: 'step-n', text: String(++n) });

    const bundles = el('div', { class: 'choices', role: 'radiogroup', 'aria-labelledby': 'setup-groups' },
      ...BUNDLES.map(b => radio(`${b.name} · ${b.groups.length}`, b.key === bundle, () => { bundle = b.key; },
        el('span', { class: 'choice-note', text: b.groups.map(([, name]) => name).join(', ') }))),
      radio('No muscle groups', bundle === 'none', () => { bundle = 'none'; },
        el('span', { class: 'choice-note', text: 'Only workouts, such as runs or gym sessions' })));

    const trainingRows = el('div', { class: 'picks' },
      ...TRAININGS.map(([id, name]) => {
        const on = picked.has(id);
        const times = picked.get(id) ?? TRAINING_TARGET;
        return el('div', { class: on ? 'pick on' : 'pick' },
          el('button', {
            type: 'button', role: 'checkbox', 'aria-checked': String(on), class: 'pick-toggle',
            onclick: () => { if (on) picked.delete(id); else picked.set(id, TRAINING_TARGET); message = ''; draw(); },
          }, el('span', { class: 'pick-box', html: ICON.tick }), name),
          on ? el('div', { class: 'pick-times', role: 'group', 'aria-label': `${name} times a week` },
            el('button', { type: 'button', class: 'mini', 'aria-label': `Fewer ${name.toLowerCase()} a week`, html: ICON.minus, disabled: times <= 1, onclick: () => { picked.set(id, clamp(times - 1, 1, 50)); draw(); } }),
            el('output', { class: 'mini-value', text: times }),
            el('button', { type: 'button', class: 'mini', 'aria-label': `More ${name.toLowerCase()} a week`, html: ICON.plus, disabled: times >= 50, onclick: () => { picked.set(id, clamp(times + 1, 1, 50)); draw(); } }),
            el('span', { class: 'muted small', text: 'a week' })) : null);
      }));

    const days = el('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'setup-week' },
      ...['monday', 'sunday'].map(d => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(weekStart === d), class: 'seg-btn',
        text: d === 'monday' ? 'Monday' : 'Sunday', onclick: () => { weekStart = d; draw(); },
      })));

    const stepper = el('div', { class: 'stepper' },
      el('button', { type: 'button', class: 'step', 'aria-label': 'Lower the goal', html: ICON.minus, disabled: goal <= 1, onclick: () => { goal = clamp(goal - 1, 1, 50); draw(); } }),
      el('output', { class: 'goal-value', 'aria-live': 'polite', text: goal }),
      el('button', { type: 'button', class: 'step', 'aria-label': 'Raise the goal', html: ICON.plus, disabled: goal >= 50, onclick: () => { goal = clamp(goal + 1, 1, 50); draw(); } }));

    fill(root,
      el('header', { class: 'top' },
        el('div', { class: 'week' },
          el('p', { class: 'brand', text: '20/7' }),
          el('h1', { text: 'Set up' }),
          el('p', { class: 'week-meta', text: 'A few choices. You can change each of them later.' }))),
      el('section', { class: 'board setup-step' },
        el('h2', { class: 'step-title', id: 'setup-groups' }, num(), 'Which muscle groups?'),
        bundles),
      el('section', { class: 'board setup-step' },
        el('h2', { class: 'step-title', id: 'setup-trainings' }, num(), sets ? 'Workouts too?' : 'Which workouts?'),
        el('p', { class: 'muted small', text: 'Count workouts such as runs or gym visits, each with its own weekly target. Optional; you can add your own later in Edit groups.' }),
        trainingRows),
      el('section', { class: 'board setup-step' },
        el('h2', { class: 'step-title', id: 'setup-week' }, num(), 'Weeks start on'),
        days,
        el('p', { class: 'muted small', text: `Counts go back to zero every ${weekStart === 'sunday' ? 'Sunday' : 'Monday'} at 00:00.` })),
      sets ? el('section', { class: 'board setup-step' },
        el('h2', { class: 'step-title', id: 'setup-goal' }, num(), 'Weekly goal'),
        el('div', { class: 'setup-goal', role: 'group', 'aria-labelledby': 'setup-goal' }, stepper, el('span', { class: 'goal-unit', text: 'sets per muscle group, each week' }))) : null,
      message ? el('p', { class: 'form-msg', role: 'alert', text: message }) : null,
      el('button', { type: 'button', class: 'btn primary wide big', text: 'Start tracking', onclick: start }));
  }
  draw();
  return { el: root };
}
