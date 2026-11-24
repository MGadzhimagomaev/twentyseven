// The main screen: this week's sets per group as tally marks. Tap a group to log a
// set, − to take one off, Undo to take back the last action. The arrows step back
// through past weeks, which can still be corrected.
import { el, fill, ICON, compact, dayMonth } from '../util.js';
import { t, tParts } from '../i18n.js';
import { shiftWeek, weekTitle, weekSubtitle } from '../week.js';
import { tallySVG } from '../tally.js';
import { seedOf } from '../bundles.js';
import { WEEKS_KEPT } from '../store.js';
import { openEditor } from './editor.js';
import { createTour } from './tour.js';
import { installCard, onInstallChange } from './install.js';

export function syncText(s) {
  const n = s.pending.length;
  switch (s.sync) {
    case 'saving': return t('sync.saving');
    case 'offline': return n ? t('sync.offline_waiting', { n }) : t('sync.offline');
    case 'error': return t('sync.error');
    case 'expired': return t('sync.expired');
    default: return n ? t('sync.saving') : t('sync.saved');
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
    toast(`${group.name} +1`, { action: t('common.undo'), onAction: undo });
  }
  function takeOne(group) {
    if (!store.tap(group.id, -1, week())) return;
    fresh = null;
    toast(`${group.name} −1`, { action: t('common.undo'), onAction: undo });
  }
  function changeGoal(n) {
    store.setGoal(n);
    const groups = store.muscleGroups();
    const own = groups.filter(g => g.own_target != null).length;
    const goal = store.goal();
    const text = own
      ? t('sets.goal_toast_own', { goal, n: groups.length - own, own, ownText: t('sets.goal_toast_own_tail', { n: own }) })
      : t('sets.goal_toast', { n: goal });
    toast(text, { action: t('common.undo'), onAction: undo });
  }

  function header(s, w, isCurrent) {
    const g = s.settings.weekly_goal;
    const title = weekTitle(w);
    return el('header', { class: 'top' },
      el('div', { class: 'top-bar' },
        el('p', { class: 'brand', text: '20/7' }),
        el('div', { class: 'week-arrows', role: 'group', 'aria-label': t('sets.change_week') },
          el('button', {
            type: 'button', class: 'ibtn', 'aria-label': t('sets.previous_week'), html: ICON.left,
            disabled: offset <= -(WEEKS_KEPT - 1), onclick: () => { offset--; fresh = null; draw(); store.loadHistory(); },
          }),
          el('button', {
            type: 'button', class: 'ibtn', 'aria-label': t('sets.next_week'), html: ICON.right,
            disabled: isCurrent, onclick: () => { offset++; fresh = null; draw(); },
          }))),
      el('div', { class: 'week' },
        el('h1', { class: title.length > 10 ? 'long' : null, text: title }),
        el('p', { class: 'week-meta', text: weekSubtitle(w, isCurrent) })),
      !isCurrent
        ? el('button', { type: 'button', class: 'btn', text: t('sets.back_to_current'), onclick: () => { offset = 0; draw(); } })
        : !store.muscleGroups().length ? null
        : el('div', { class: 'goal', role: 'group', 'aria-labelledby': 'goal-label' },
          el('span', { class: 'label', id: 'goal-label', text: t('sets.weekly_goal') }),
          el('div', { class: 'stepper' },
            el('button', { type: 'button', class: 'step', 'aria-label': t('sets.lower_goal'), html: ICON.minus, disabled: g <= 1, onclick: () => changeGoal(g - 1) }),
            el('output', { class: 'goal-value', 'aria-live': 'polite', text: g }),
            el('button', { type: 'button', class: 'step', 'aria-label': t('sets.raise_goal'), html: ICON.plus, disabled: g >= 50, onclick: () => changeGoal(g + 1) })),
          el('span', { class: 'goal-unit', text: t('sets.per_group') })));
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
    if (sum.groups) bits.push(t('recap.groups', { done: sum.done, n: sum.groups }), t('recap.sets', { n: sum.sets }));
    if (tr.n) bits.push(t('recap.workouts', { count: tr.count, n: tr.target }));
    if (sum.steps.avg != null) bits.push(t('recap.steps', { steps: compact(sum.steps.avg) }));
    return el('section', { class: 'recap', 'aria-label': t('recap.last_week') },
      el('div', { class: 'recap-body' },
        el('p', { class: 'label', text: t('recap.last_week') }),
        el('p', { class: 'recap-line', text: bits.join(' · ') }),
        el('a', { class: 'recap-link', href: '#history', text: t('recap.see_history') })),
      el('button', { type: 'button', class: 'ibtn', 'aria-label': t('common.close'), html: ICON.close, onclick: () => store.closeRecap(w.id) }));
  }

  function stats(s, sum) {
    const items = [];
    if (sum.groups) {
      items.push(
        el('p', { class: 'stat' }, el('span', { class: 'label', text: t('stats.sets') }),
          el('span', { class: 'stat-value' }, String(sum.sets), el('small', { text: `/${sum.target}` }))),
        el('p', { class: 'stat' }, el('span', { class: 'label', text: t('stats.at_goal') }),
          el('span', { class: 'stat-value' }, String(sum.done), el('small', { text: `/${sum.groups}` }))));
    }
    if (sum.trainings.n) {
      items.push(el('p', { class: 'stat' }, el('span', { class: 'label', text: t('stats.workouts') }),
        el('span', { class: 'stat-value' }, String(sum.trainings.count), el('small', { text: `/${sum.trainings.target}` }))));
    }
    if (s.settings.show_steps_on_sets) {
      const st = sum.steps;
      items.push(el('p', { class: 'stat', title: st.any ? t('stats.steps_title') : t('stats.steps_from_iphone') },
        el('span', { class: 'label', text: t('stats.steps') }),
        el('span', { class: 'stat-value' }, st.avg != null ? compact(st.avg) : '–', el('small', { text: `/${compact(st.goal)}` }))));
    }
    return items.length ? el('div', { class: `summary cols-${items.length}` }, ...items) : null;
  }

  function hint(isCurrent, w, sum) {
    if (!isCurrent) return el('p', { class: 'hint', text: t('hint.past_week', { day: dayMonth(w.end) }) });
    if (!sum.sets && !sum.trainings.count) {
      const text = sum.groups ? t('hint.tap_group') : t('hint.tap_workout');
      return el('p', { class: 'hint', text });
    }
    return null;
  }

  function tile(item) {
    const { group: g, count, target, done } = item;
    const isFresh = fresh && fresh.id === g.id && Date.now() - fresh.at < 800;
    const over = Math.max(0, count - target);
    return el('div', { class: 'cell', 'data-id': g.id, 'data-state': done ? 'done' : null },
      el('button', {
        type: 'button', class: 'cell-add', 'aria-label': t(item.training ? 'tile.add_workout' : 'tile.add_set', { name: g.name, count, target }),
        onclick: () => add(g),
      }),
      el('p', { class: 'cell-name' },
        el('span', { class: 'cell-label', text: g.name }),
        item.own ? el('span', { class: 'own', title: t('tile.own_target'), 'aria-label': t('tile.own_target'), html: ICON.lock }) : null,
        el('span', { class: 'tick-wrap', html: ICON.tick })),
      el('div', { class: 'cell-row' },
        el('p', { class: 'count' },
          el('span', { class: isFresh ? 'n pop' : 'n', text: count }),
          el('span', { class: 'of', text: `/${target}` }),
          over ? el('span', { class: 'extra', text: `+${over}` }) : null),
        el('button', {
          type: 'button', class: 'cell-sub', 'aria-label': t(item.training ? 'tile.take_workout' : 'tile.take_set', { name: g.name }),
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
    const muscleTiles = tiles.filter(x => !x.training), trainingTiles = tiles.filter(x => x.training);
    const last = store.lastUndo();

    const board = el('section', { class: 'board', 'aria-label': isCurrent ? t('board.this_week') : t('board.that_week') },
      stats(s, sum),
      hint(isCurrent, w, sum),
      muscleTiles.length ? el('div', { class: 'grid' }, ...muscleTiles.map(tile)) : null,
      trainingTiles.length && muscleTiles.length ? el('h2', { class: 'section-label', text: t('stats.workouts') }) : null,
      trainingTiles.length ? el('div', { class: 'grid trainings' }, ...trainingTiles.map(tile)) : null,
      tiles.length ? null : el('p', { class: 'hint', text: t('hint.nothing') }),
      el('div', { class: 'tray' },
        el('button', { type: 'button', class: 'tray-btn edit', html: ICON.edit, onclick: () => openEditor(ctx) }, t('sets.edit_groups')),
        el('button', {
          type: 'button', class: 'tray-btn undo', html: ICON.undo, disabled: !last,
          title: last ? t('undo.title', { what: last.label }) : t('undo.nothing'), onclick: undo,
        }, el('span', { text: t('common.undo') }), last ? el('span', { class: 'undo-what', text: last.label }) : null)));

    fill(root,
      header(s, w, isCurrent),
      isCurrent ? recap(s, w) : null,
      isCurrent && !s.showTips && !tour ? installCard(draw) : null,
      board,
      el('footer', { class: 'foot' },
        el('p', { class: 'sync', 'data-state': s.sync === 'saved' && s.pending.length ? 'saving' : s.sync },
          el('span', { class: 'dot' }), el('span', { text: syncText(s) })),
        el('p', { text: t(store.weekStart() === 'sunday' ? 'sets.resets_sunday' : 'sets.resets_monday') })));
  }

  // The tour follows what the person counts: muscle groups, trainings or both.
  function startTour() {
    const sunday = store.weekStart() === 'sunday';
    const hasSets = store.muscleGroups().length > 0, hasTrainings = store.trainings().length > 0;
    const q = sel => () => root.querySelector(sel) || document.querySelector(sel);
    const icon = name => el('span', { class: 'inline-icon', html: ICON[name] });
    const steps = [
      { id: 'log', target: q('.grid .cell'), title: t(hasSets ? 'tour.log.title_sets' : 'tour.log.title_workouts'),
        text: t(hasSets ? 'tour.log.text_sets' : 'tour.log.text_workouts') },
      { id: 'minus', target: () => root.querySelector(`.cell[data-id="${tappedId}"] .cell-sub`) || root.querySelector('.cell-sub'), title: t('tour.minus.title'),
        text: t(hasSets ? 'tour.minus.text_sets' : 'tour.minus.text_workouts') },
      { id: 'undo', target: q('.tray-btn.undo'), title: t('tour.undo.title'), text: t('tour.undo.text') },
      { id: 'week', target: q('.summary'), title: t('tour.week.title'),
        text: [hasSets ? t('tour.week.sets') : '', hasTrainings ? t(hasSets ? 'tour.week.workouts_too' : 'tour.week.workouts_only') : '', t('tour.week.green')]
          .filter(Boolean).join(' ') },
    ];
    if (hasSets) {
      steps.push(
        { id: 'goal', target: q('.goal'), title: t('tour.goal.title'), text: t('tour.goal.text') },
        { id: 'own', target: q('.tray-btn.edit'), title: t('tour.own.title'), text: tParts('tour.own.text', { unlock: icon('unlock'), lock: icon('lock') }) });
    }
    steps.push(
      { id: 'groups', target: q('.tray-btn.edit'), title: t('tour.groups.title'), text: t('tour.groups.text') },
      { id: 'trainings', target: hasTrainings ? () => root.querySelector('.section-label') || root.querySelector('.grid.trainings') : q('.tray-btn.edit'), title: t('tour.workouts.title'),
        text: t(hasTrainings ? 'tour.workouts.have' : 'tour.workouts.none') },
      { id: 'weeks', target: q('.week-arrows'), title: t('tour.weeks.title'), text: t(sunday ? 'tour.weeks.text_sunday' : 'tour.weeks.text_monday') },
      { id: 'saved', target: q('.sync'), title: t('tour.saved.title'), text: t('tour.saved.text') },
      { id: 'history', target: q('.tab[href="#history"]'), title: t('tour.history.title'), text: t('tour.history.text') },
      { id: 'settings', target: q('.tab[href="#settings"]'), title: t('tour.settings.title'), text: t('tour.settings.text') });
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
