// The main screen: this week's sets per group as tally marks. Tap a group to log a
// set, − to take one off, Undo to take back the last action. The arrows step back
// through past weeks, which can still be corrected.
import { el, fill, ICON, compact, dayMonth, plural } from '../util.js';
import { shiftWeek, weekTitle, weekSubtitle, resetDayName } from '../week.js';
import { tallySVG } from '../tally.js';
import { seedOf } from '../bundles.js';
import { WEEKS_KEPT } from '../store.js';
import { openEditor } from './editor.js';
import { createTour } from './tour.js';
import { installCard, onInstallChange } from './install.js';

export function syncText(s) {
  const n = s.pending.length;
  switch (s.sync) {
    case 'saving': return 'Saving…';
    case 'offline': return n ? `Offline · ${plural(n, 'change', 'changes')} waiting` : 'Offline';
    case 'error': return 'Couldn’t save · trying again';
    case 'expired': return 'Sign-in expired · changes wait on this device';
    default: return n ? 'Saving…' : 'Saved';
  }
}

export function setsView(ctx) {
  const { store, toast, undo } = ctx;
  let offset = 0;                 // 0 = this week, -1 = the week before, …
  let fresh = null;               // the last tap, so its stroke draws in
  let tour = null;                // the first-launch tour, while it runs
  let tappedId = null;            // the group tapped during the tour, for the − step

  const root = el('main', { class: 'page sets' });
  const stopInstall = onInstallChange(() => draw());
  const week = () => (offset ? shiftWeek(store.currentWeek(), offset) : store.currentWeek());

  function add(group) {
    if (!store.tap(group.id, 1, week())) return;
    fresh = { id: group.id, at: Date.now() };
    if (tour?.step?.id === 'log') { tappedId = group.id; tour.next(); return; }
    toast(`${group.name} +1`, { action: 'Undo', onAction: undo });
  }
  function takeOne(group) {
    if (!store.tap(group.id, -1, week())) return;
    fresh = null;
    toast(`${group.name} −1`, { action: 'Undo', onAction: undo });
  }
  function changeGoal(n) {
    store.setGoal(n);
    const groups = store.muscleGroups();
    const own = groups.filter(g => g.own_target != null).length;
    const goal = store.goal();
    const text = own
      ? `Goal ${goal} · ${plural(groups.length - own, 'group follows', 'groups follow')} it, ${own} ${own === 1 ? 'has its' : 'have their'} own`
      : `Goal ${goal}`;
    toast(text, { action: 'Undo', onAction: undo });
  }

  function header(s, w, isCurrent) {
    const g = s.settings.weekly_goal;
    const title = weekTitle(w);
    return el('header', { class: 'top' },
      el('div', { class: 'top-bar' },
        el('p', { class: 'brand', text: '20/7' }),
        el('div', { class: 'week-arrows', role: 'group', 'aria-label': 'Change week' },
          el('button', {
            type: 'button', class: 'ibtn', 'aria-label': 'Previous week', html: ICON.left,
            disabled: offset <= -(WEEKS_KEPT - 1), onclick: () => { offset--; fresh = null; draw(); store.loadHistory(); },
          }),
          el('button', {
            type: 'button', class: 'ibtn', 'aria-label': 'Next week', html: ICON.right,
            disabled: isCurrent, onclick: () => { offset++; fresh = null; draw(); },
          }))),
      el('div', { class: 'week' },
        el('h1', { class: title.length > 10 ? 'long' : null, text: title }),
        el('p', { class: 'week-meta', text: weekSubtitle(w, isCurrent) })),
      !isCurrent
        ? el('button', { type: 'button', class: 'btn', text: 'Back to current week', onclick: () => { offset = 0; draw(); } })
        : !store.muscleGroups().length ? null
        : el('div', { class: 'goal', role: 'group', 'aria-labelledby': 'goal-label' },
          el('span', { class: 'label', id: 'goal-label', text: 'Weekly goal' }),
          el('div', { class: 'stepper' },
            el('button', { type: 'button', class: 'step', 'aria-label': 'Lower the weekly goal', html: ICON.minus, disabled: g <= 1, onclick: () => changeGoal(g - 1) }),
            el('output', { class: 'goal-value', 'aria-live': 'polite', text: g }),
            el('button', { type: 'button', class: 'step', 'aria-label': 'Raise the weekly goal', html: ICON.plus, disabled: g >= 50, onclick: () => changeGoal(g + 1) })),
          el('span', { class: 'goal-unit', text: 'sets per group' })));
  }

  // The week before, summed up during the first days of a new week.
  function recap(s, w) {
    const elapsed = 7 - w.daysLeft;
    if (s.recapSeen === w.id || elapsed > 2) return null;
    const last = shiftWeek(w, -1);
    const sum = store.summary(last);
    const tr = sum.trainings;
    if (!sum.sets && !tr.count) return null;
    const bits = [];
    if (sum.groups) bits.push(`${sum.done} of ${sum.groups} groups at goal`, plural(sum.sets, 'set', 'sets'));
    if (tr.n) bits.push(`${tr.count} of ${tr.target} ${tr.target === 1 ? 'workout' : 'workouts'}`);
    if (sum.steps.avg != null) bits.push(`${compact(sum.steps.avg)} steps a day`);
    return el('section', { class: 'recap', 'aria-label': 'Last week' },
      el('div', { class: 'recap-body' },
        el('p', { class: 'label', text: 'Last week' }),
        el('p', { class: 'recap-line', text: bits.join(' · ') }),
        el('a', { class: 'recap-link', href: '#history', text: 'See history' })),
      el('button', { type: 'button', class: 'ibtn', 'aria-label': 'Close', html: ICON.close, onclick: () => store.closeRecap(w.id) }));
  }

  function stats(s, sum) {
    const items = [];
    if (sum.groups) {
      items.push(
        el('p', { class: 'stat' }, el('span', { class: 'label', text: 'Sets' }),
          el('span', { class: 'stat-value' }, String(sum.sets), el('small', { text: `/${sum.target}` }))),
        el('p', { class: 'stat' }, el('span', { class: 'label', text: 'At goal' }),
          el('span', { class: 'stat-value' }, String(sum.done), el('small', { text: `/${sum.groups}` }))));
    }
    if (sum.trainings.n) {
      items.push(el('p', { class: 'stat' }, el('span', { class: 'label', text: 'Workouts' }),
        el('span', { class: 'stat-value' }, String(sum.trainings.count), el('small', { text: `/${sum.trainings.target}` }))));
    }
    if (s.settings.show_steps_on_sets) {
      const st = sum.steps;
      items.push(el('p', { class: 'stat', title: st.any ? 'Average steps a day this week' : 'Steps come from the iPhone app' },
        el('span', { class: 'label', text: 'Steps/day' }),
        el('span', { class: 'stat-value' }, st.avg != null ? compact(st.avg) : '–', el('small', { text: `/${compact(st.goal)}` }))));
    }
    return items.length ? el('div', { class: `summary cols-${items.length}` }, ...items) : null;
  }

  function hint(isCurrent, w, sum) {
    if (!isCurrent) return el('p', { class: 'hint', text: `Past week. Anything you add here counts on ${dayMonth(w.end)}.` });
    if (!sum.sets && !sum.trainings.count) {
      const text = sum.groups ? 'Tap a muscle group each time you finish a set.' : 'Tap a workout each time you do one.';
      return el('p', { class: 'hint', text });
    }
    return null;
  }

  function tile(t, index) {
    const { group: g, count, target, done } = t;
    const isFresh = fresh && fresh.id === g.id && Date.now() - fresh.at < 800;
    const over = Math.max(0, count - target);
    return el('div', { class: 'cell', 'data-id': g.id, 'data-state': done ? 'done' : null },
      el('button', {
        type: 'button', class: 'cell-add', 'aria-label': `${g.name}: ${count} of ${target}. Add ${t.training ? 'one' : 'a set'}`,
        onclick: () => add(g),
      }),
      el('p', { class: 'cell-name' },
        el('span', { class: 'cell-label', text: g.name }),
        t.own ? el('span', { class: 'own', title: 'Own target', 'aria-label': 'own target', html: ICON.lock }) : null,
        el('span', { class: 'tick-wrap', html: ICON.tick })),
      el('div', { class: 'cell-row' },
        el('p', { class: 'count' },
          el('span', { class: isFresh ? 'n pop' : 'n', text: count }),
          el('span', { class: 'of', text: `/${target}` }),
          over ? el('span', { class: 'extra', text: `+${over}` }) : null),
        el('button', {
          type: 'button', class: 'cell-sub', 'aria-label': `Take one ${t.training ? '' : 'set '}off ${g.name}`,
          html: ICON.minus, disabled: count <= 0, onclick: () => takeOne(g),
        })),
      el('div', { class: 'tally', html: tallySVG(count, target, seedOf(g.id), isFresh ? count - 1 : -1) }));
  }

  function draw() {
    const s = store.state;
    if (!s.settings) return;
    const w = week();
    const isCurrent = offset === 0;
    const sum = store.summary(w);
    const tiles = store.tiles(w);
    const muscleTiles = tiles.filter(t => !t.training), trainingTiles = tiles.filter(t => t.training);
    const last = store.lastUndo();

    const board = el('section', { class: 'board', 'aria-label': isCurrent ? 'This week' : 'That week' },
      stats(s, sum),
      hint(isCurrent, w, sum),
      muscleTiles.length ? el('div', { class: 'grid' }, ...muscleTiles.map(tile)) : null,
      trainingTiles.length && muscleTiles.length ? el('h2', { class: 'section-label', text: 'Workouts' }) : null,
      trainingTiles.length ? el('div', { class: 'grid trainings' }, ...trainingTiles.map(tile)) : null,
      tiles.length ? null : el('p', { class: 'hint', text: 'Nothing to count yet. Add groups or workouts in Edit groups.' }),
      el('div', { class: 'tray' },
        el('button', { type: 'button', class: 'tray-btn edit', html: ICON.edit, onclick: () => openEditor(ctx) }, 'Edit groups'),
        el('button', {
          type: 'button', class: 'tray-btn undo', html: ICON.undo, disabled: !last,
          title: last ? `Undo: ${last.label}` : 'Nothing to undo', onclick: undo,
        }, el('span', { text: 'Undo' }), last ? el('span', { class: 'undo-what', text: last.label }) : null)));

    fill(root,
      header(s, w, isCurrent),
      isCurrent ? recap(s, w) : null,
      isCurrent && !s.showTips && !tour ? installCard(draw) : null,
      board,
      el('footer', { class: 'foot' },
        el('p', { class: 'sync', 'data-state': s.sync === 'saved' && s.pending.length ? 'saving' : s.sync },
          el('span', { class: 'dot' }), el('span', { text: syncText(s) })),
        el('p', { text: `Resets every ${resetDayName(store.weekStart())} at 00:00` })));
  }

  // The tour follows what the person counts: muscle groups, trainings or both.
  function startTour() {
    const ws = store.weekStart() === 'sunday' ? 'Sunday' : 'Monday';
    const hasSets = store.muscleGroups().length > 0, hasTrainings = store.trainings().length > 0;
    const q = sel => () => root.querySelector(sel) || document.querySelector(sel);
    const icon = name => el('span', { class: 'inline-icon', html: ICON[name] });
    const steps = [
      { id: 'log', target: q('.grid .cell'), title: hasSets ? 'Log a set' : 'Log a workout',
        text: hasSets ? 'Tap a group each time you finish a set. Try it now.' : 'Tap a workout each time you do one. Try it now.' },
      { id: 'minus', target: () => root.querySelector(`.cell[data-id="${tappedId}"] .cell-sub`) || root.querySelector('.cell-sub'), title: 'One too many?',
        text: hasSets ? '− takes one set off a group.' : '− takes one off.' },
      { id: 'undo', target: q('.tray-btn.undo'), title: 'Undo',
        text: 'Undo takes back your last action: a tap, a goal change, a group edit. Tap it again to go further back. The note at the bottom after each action has Undo too, and on a computer Ctrl+Z works.' },
      { id: 'week', target: q('.summary'), title: 'This week',
        text: [hasSets ? 'Sets so far against this week’s total target, and how many groups reached their goal.' : '',
          hasTrainings ? (hasSets ? ' Workouts add up on their own.' : 'Workouts done so far against this week’s targets.') : '',
          ' A tile turns green with a tick when it reaches its goal.'].join('').trim() },
    ];
    if (hasSets) {
      steps.push(
        { id: 'goal', target: q('.goal'), title: 'Weekly goal',
          text: 'How many sets each group should get this week. Every group follows it. Want a different number for one group? You can set it in Edit groups: see the next tip.' },
        { id: 'own', target: q('.tray-btn.edit'), title: 'A goal for one group',
          text: ['In Edit groups, tap ', icon('unlock'), ' next to a group, set its number with − and +, then Save groups. It shows ', icon('lock'), ' from then on, and the weekly goal no longer changes it. Tap the lock again to make it follow the weekly goal.'] });
    }
    steps.push(
      { id: 'groups', target: q('.tray-btn.edit'), title: 'Your groups',
        text: 'Edit groups lets you rename, add, remove and reorder, or start from a ready-made set: Push / Pull / Legs, Classic, Extended or Detailed. Removed ones keep their history.' },
      { id: 'trainings', target: hasTrainings ? () => root.querySelector('.section-label') || root.querySelector('.grid.trainings') : q('.tray-btn.edit'), title: 'Workouts',
        text: hasTrainings
          ? 'Runs, rides, gym sessions: anything you count per week. Each has its own weekly target, set in Edit groups, and they never count as sets.'
          : 'Not only muscle groups: in Edit groups you can add workouts such as runs, rides or gym sessions, each with its own weekly target. They add up apart from your sets.' },
      { id: 'weeks', target: q('.week-arrows'), title: 'Past weeks',
        text: `Counts start over every ${ws} at 00:00. The arrows step back through earlier weeks, where you can still add what you forgot. At the start of a week, a card sums up the last one.` },
      { id: 'saved', target: q('.sync'), title: 'Saved everywhere',
        text: 'Saved means it’s in your account and shows on all your devices. Without a connection, changes wait on this device and save once you’re back online.' },
      { id: 'history', target: q('.tab[href="#history"]'), title: 'History',
        text: 'Each week at a glance: a grid by week (tap a name for its own chart), charts for sets, workouts and steps, and a log of every action, where you can remove a mistake.' },
      { id: 'settings', target: q('.tab[href="#settings"]'), title: 'Settings',
        text: 'Week start, daily step goal, steps on this screen, export your data, delete your account, and this tour again. Sets, at the bottom left, always brings you back here.' });
    tour = createTour(steps, { onEnd: () => { tour = null; store.setShowTips(false); } });
  }

  return {
    el: root,
    update(s) {
      if (offset && s.showTips && !tour) offset = 0;
      draw();
      if (s.showTips && !tour) startTour();
      else if (!s.showTips && tour) tour.end();
      tour?.place();
    },
    afterUndo() {
      if (tour?.step?.id === 'undo') tour.next();
    },
    destroy() { tour?.end(); stopInstall(); },
  };
}
