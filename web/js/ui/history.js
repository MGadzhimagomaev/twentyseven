// History: the last 12 weeks as a grid of groups by week, sets per week against the
// target, steps per week, and one group at a time. The Log lists every action,
// newest first, and a mistaken set can be removed from it.
import { el, ICON, compact, number, range, axisDate, weekdayDayMonth, time, isoDate, addDays } from '../util.js';
import { t } from '../i18n.js';
import { weekTitle, isoWeekNumber, weekStartOf } from '../week.js';
import { WEEKS_KEPT } from '../store.js';

// 0 none · 1–4 a quarter of the target each · 5 at goal (also ticked).
const levelOf = (sets, target) => (sets <= 0 ? 0 : sets >= target ? 5 : 1 + Math.min(3, Math.floor((sets / target) * 4)));

function niceCeil(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Columns, one per week, with an optional target tick per week or one goal line.
// Returns an element; the svg is drawn once the element has a width.
function barChart({ items, refLine, refLabel, unit, fmt = number, label }) {
  const readout = el('p', { class: 'readout', 'aria-live': 'polite' });
  const plot = el('div', { class: 'plot' });
  const wrap = el('div', { class: 'chart' }, readout, plot);
  let picked = items.length - 1;

  // `focus` dims the other weeks while someone points at one.
  function say(i, focus = false) {
    const d = items[i];
    if (!d) return;
    const bits = [d.title, d.value == null ? t('chart.no_data') : t(unit, { n: d.value, value: fmt(d.value) })];
    if (d.target != null) bits.push(t('chart.target', { value: fmt(d.target) }));
    if (d.note) bits.push(d.note);
    readout.textContent = bits.join(' · ');
    for (const b of plot.querySelectorAll('[data-i]')) b.classList.toggle('dim', focus && Number(b.dataset.i) !== i);
  }

  wrap.draw = () => {
    const W = Math.max(260, Math.floor(plot.clientWidth || 320)), H = 156;
    const padL = 38, padR = 8, padT = 10, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const top = niceCeil(Math.max(1, refLine || 0, ...items.map(d => Math.max(d.value || 0, d.target || 0))));
    const y = v => padT + ih - (v / top) * ih;
    const slot = iw / items.length, bw = Math.min(24, Math.max(6, slot - 8));
    const every = Math.max(1, Math.ceil(46 / slot));
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">`;
    for (const v of [0, top / 2, top]) {
      svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
    }
    items.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2, x = cx - bw / 2;
      if (d.value > 0) {
        const h = Math.max(1, (d.value / top) * ih), y0 = padT + ih, yt = y0 - h, r = Math.min(4, h, bw / 2);
        const goal = d.target ?? refLine;
        const done = goal != null && goal > 0 && d.value >= goal;
        svg += `<path class="bar${done ? ' done' : ''}" data-i="${i}" d="M${x} ${y0}V${yt + r}Q${x} ${yt} ${x + r} ${yt}H${x + bw - r}Q${x + bw} ${yt} ${x + bw} ${yt + r}V${y0}Z"/>`;
      }
      if (d.target != null && d.target > 0) {
        svg += `<line class="target" data-i="${i}" x1="${x - 3}" x2="${x + bw + 3}" y1="${y(d.target)}" y2="${y(d.target)}"/>`;
      }
      if ((items.length - 1 - i) % every === 0) {
        svg += `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${d.short}</text>`;
      }
    });
    if (refLine) {
      svg += `<line class="ref" x1="${padL}" x2="${W - padR}" y1="${y(refLine)}" y2="${y(refLine)}"/>`;
      svg += `<text class="axis strong" x="${W - padR}" y="${y(refLine) - 5}" text-anchor="end">${refLabel}</text>`;
    }
    svg += `<rect class="hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}"/></svg>`;
    plot.innerHTML = svg;
    const hit = plot.querySelector('svg');
    const at = e => Math.max(0, Math.min(items.length - 1, Math.floor((e.clientX - hit.getBoundingClientRect().left - padL) / slot)));
    hit.addEventListener('pointermove', e => say(at(e), true));
    hit.addEventListener('pointerdown', e => { picked = at(e); say(picked, true); });
    hit.addEventListener('pointerleave', () => say(picked));
    hit.addEventListener('blur', () => say(picked));
    hit.setAttribute('tabindex', '0');
    hit.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        picked = Math.max(0, Math.min(items.length - 1, picked + (e.key === 'ArrowLeft' ? -1 : 1)));
        say(picked, true);
      }
    });
    say(picked);
  };
  return wrap;
}

// "▮ Sets ▮ At goal ─ Target" under a chart.
function chartKey(value, atGoal, target) {
  return el('p', { class: 'chart-key' },
    el('span', { class: 'key-bar' }), `${value} `, el('span', { class: 'key-bar done' }), atGoal,
    target ? [' ', el('span', { class: 'key-line' }), target] : null);
}

function tableView(head, rows) {
  return el('details', { class: 'table-view' },
    el('summary', { text: t('history.table') }),
    el('div', { class: 'table-scroll' },
      el('table', {},
        el('thead', {}, el('tr', {}, ...head.map(h => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map((c, i) => (i === 0 ? el('th', { scope: 'row', text: c }) : el('td', { text: c })))))))));
}

function logText(r) {
  const name = r.group_name || r.group_id;
  switch (r.kind) {
    case 'set': {
      const d = Number(r.new_value);
      return `${name} ${d > 0 ? '+' : '−'}${Math.abs(d)}`;
    }
    case 'weekly_goal': return t('log.weekly_goal', { old: r.old_value, new: r.new_value });
    case 'step_goal': return t('log.step_goal', { old: number(Number(r.old_value)), new: number(Number(r.new_value)) });
    case 'week_start': return r.new_value === 'sunday' || r.new_value === 'monday' ? t(`log.week_start_${r.new_value}`) : r.kind;
    case 'group_target':
      if (r.new_value == null) return t('log.target_follows', { name });
      if (r.old_value == null) return t('log.target_own', { name, value: r.new_value });
      return t('log.target_change', { name, old: r.old_value, new: r.new_value });
    case 'group_added': return t('log.added', { name: r.new_value || name });
    case 'group_renamed': return t('log.renamed', { old: r.old_value, new: r.new_value });
    case 'group_removed': return t('log.removed', { name });
    case 'group_restored': return t('log.restored', { name });
    default: return r.kind;
  }
}

function dayHeading(day) {
  const today = isoDate();
  if (day === today) return t('log.today');
  if (day === addDays(today, -1)) return t('log.yesterday');
  return weekdayDayMonth(day);
}

export function historyView(ctx) {
  const { store, toast, undo, go } = ctx;
  let tab = 'weeks';
  let selected = null;              // group id for the one-group chart
  let cellNote = '';
  let log = [], logOffset = 0, logDone = false, logLoading = false, logError = null, logLoaded = false;
  const PAGE = 100;

  const root = el('main', { class: 'page history' });
  const resize = new ResizeObserver(() => { for (const c of root.querySelectorAll('.chart')) c.draw?.(); });
  resize.observe(root);

  async function loadLog(reset = false) {
    if (logLoading) return;
    if (reset) { log = []; logOffset = 0; logDone = false; }
    logLoading = true; logError = null; draw();
    try {
      const rows = await store.activity(logOffset, PAGE);
      log.push(...rows);
      logOffset += rows.length;
      logDone = rows.length < PAGE;
      logLoaded = true;
    } catch (e) {
      logError = e;
    }
    logLoading = false;
    draw();
  }

  function removeSet(r) {
    store.removeEntry(r);
    log = log.filter(x => x !== r);
    draw();
    toast(t('undo.removed', { what: logText(r) }), { action: t('common.undo'), onAction: () => { undo(); } });
  }

  function axisWeeks() {
    const start = store.currentWeek().start;
    return Array.from({ length: WEEKS_KEPT }, (_, i) => addDays(start, -7 * (WEEKS_KEPT - 1 - i)));
  }

  function weeksPanel() {
    const s = store.state;
    const rows = store.historyRows();
    if (!rows) {
      return el('section', { class: 'board panel' },
        el('p', { class: 'hint', text: t(s.historyError ? (s.historyError.kind === 'network' ? 'history.offline_first' : 'history.load_failed') : 'history.loading') }),
        s.historyError ? el('div', { class: 'tray' }, el('button', { type: 'button', class: 'tray-btn', text: t('common.try_again'), onclick: () => store.loadHistory(true) })) : null);
    }
    const weeks = axisWeeks();
    const ws = store.weekStart();
    const titleOf = w => weekTitle({ start: w, end: addDays(w, 6), weekStart: ws, number: isoWeekNumber(w) });
    const kinds = new Map(s.groups.map(g => [g.id, g.kind || 'sets']));
    const groups = new Map();
    for (const r of rows) {
      let g = groups.get(r.group_id);
      if (!g) groups.set(r.group_id, (g = { id: r.group_id, name: r.group_name, position: r.position, archived: r.archived, training: kinds.get(r.group_id) === 'sessions', cells: new Map() }));
      g.cells.set(r.week_start, r);
    }
    // Muscle groups first, then trainings; removed ones at the end of each.
    const list = [...groups.values()].sort((a, b) => (a.training - b.training) || (a.archived - b.archived) || (a.position - b.position));
    if (!list.length) {
      return el('section', { class: 'board panel' }, el('p', { class: 'hint', text: t('history.empty') }));
    }
    const unitOf = g => (g.training ? 'unit.workouts' : 'unit.sets');
    const removedName = g => (g.archived ? t('history.removed_name', { name: g.name }) : g.name);
    const firstTraining = list.find(g => g.training);

    // Groups by week.
    const label = axisDate;
    const head = el('div', { class: 'heat-row heat-head', 'aria-hidden': 'true' }, el('span', {}),
      ...weeks.map((w, i) => el('span', { class: 'heat-x', text: (WEEKS_KEPT - 1 - i) % 3 === 0 ? label(w) : '' })));
    const heat = el('div', { class: 'heat', style: `--cols:${weeks.length}` },
      ...list.flatMap(g => [
        g === firstTraining && list[0] !== g ? el('p', { class: 'label heat-section', text: t('stats.workouts') }) : null,
        el('div', { class: 'heat-row' },
        el('button', {
          type: 'button', class: selected === g.id ? 'heat-name on' : 'heat-name', 'aria-pressed': String(selected === g.id),
          title: g.archived ? removedName(g) : t('history.name_by_week', { name: g.name }), onclick: () => { selected = selected === g.id ? null : g.id; draw(); },
          'aria-label': t('history.name_by_week', { name: removedName(g) }),
        }, el('span', { class: g.archived ? 'removed' : null, text: g.name })),
        ...weeks.map(w => {
          const c = g.cells.get(w);
          if (!c) return el('span', { class: 'hc none', 'aria-hidden': 'true' });
          const lv = levelOf(c.sets, c.target);
          const text = t(g.training ? 'history.cell_workouts' : 'history.cell_sets', { name: g.name, range: range(w, addDays(w, 6)), count: c.sets, n: c.target });
          const show = () => { cellNote = text; const n = root.querySelector('.heat-note'); if (n) n.textContent = text; };
          return el('button', {
            type: 'button', class: 'hc', 'data-l': String(lv), 'aria-label': text,
            html: lv === 5 ? ICON.tick : '', onclick: show, onpointerenter: show, onfocus: show,
          });
        }))]),
      head);
    const legend = el('div', { class: 'heat-legend', 'aria-hidden': 'true' },
      el('span', { text: t('history.share') }),
      ...[1, 2, 3, 4].map(l => el('span', { class: 'hc', 'data-l': String(l) })),
      el('span', { class: 'hc', 'data-l': '5', html: ICON.tick }), el('span', { text: t('history.at_goal_legend') }));
    const heatTable = tableView([t('history.name'), ...weeks.map(label)],
      list.map(g => [removedName(g), ...weeks.map(w => { const c = g.cells.get(w); return c ? `${c.sets}/${c.target}` : '–'; })]));

    // One group, week by week.
    let groupPanel = null;
    const sel = selected && groups.get(selected);
    if (sel) {
      const items = weeks.map(w => {
        const c = sel.cells.get(w);
        return { title: titleOf(w), short: label(w), value: c ? c.sets : null, target: c ? c.target : null };
      });
      const Many = t(sel.training ? 'stats.workouts' : 'stats.sets');
      groupPanel = el('section', { class: 'board panel' },
        el('div', { class: 'panel-head' },
          el('h2', { class: 'panel-title', text: t('history.name_by_week', { name: sel.name }) }),
          el('button', { type: 'button', class: 'ibtn', 'aria-label': t('common.close'), html: ICON.close, onclick: () => { selected = null; draw(); } })),
        barChart({ items, unit: unitOf(sel), label: t(sel.training ? 'history.group_chart_workouts' : 'history.group_chart_sets', { name: sel.name }) }),
        chartKey(Many, t('stats.at_goal'), t('history.target_key')),
        tableView([t('history.week'), Many, t('history.target_key')], items.map(d => [d.short, d.value ?? '–', d.target ?? '–'])));
    }

    // All muscle groups together, and all trainings together: never mixed.
    const totalsOf = (members, what) => weeks.map(w => {
      let sets = 0, target = 0, done = 0, n = 0;
      for (const g of members) {
        const c = g.cells.get(w);
        if (!c) continue;
        sets += c.sets; target += c.target; n++;
        if (c.sets >= c.target) done++;
      }
      return { title: titleOf(w), short: label(w), value: n ? sets : null, target: n ? target : null, note: n ? t(what, { done, n }) : '' };
    });
    const muscleList = list.filter(g => !g.training), trainingList = list.filter(g => g.training);
    const totals = totalsOf(muscleList, 'recap.groups');
    const trainingTotals = totalsOf(trainingList, 'history.workouts_at_goal');

    // Steps, from the iPhone app.
    const stepRows = new Map((s.history.steps || []).map(r => [r.week_start, r]));
    const anySteps = [...stepRows.values()].some(r => Number(r.days_logged) > 0);
    const stepGoal = s.settings.step_goal;
    const stepItems = weeks.map(w => {
      const r = stepRows.get(w);
      const days = r ? Number(r.days_logged) : 0;
      return {
        title: titleOf(w), short: label(w), value: days ? Math.round(Number(r.avg_steps)) : null,
        note: days ? t('history.steps_days', { n: Number(r.days_at_goal), days }) : '',
      };
    });

    return el('div', { class: 'stack' },
      el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: t('history.week_by_week') }),
        el('p', { class: 'panel-note', text: t('history.week_by_week_note') }),
        heat,
        el('p', { class: 'readout heat-note', 'aria-live': 'polite', text: cellNote || t('history.tap_square') }),
        legend,
        heatTable),
      groupPanel,
      muscleList.length ? el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: t('history.sets_per_week') }),
        barChart({ items: totals, unit: 'unit.sets', label: t('history.sets_chart') }),
        chartKey(t('history.key_all_groups'), t('stats.at_goal'), t('history.target_key')),
        tableView([t('history.week'), t('stats.sets'), t('history.target_key'), t('history.groups_at_goal')], totals.map(d => [d.short, d.value ?? '–', d.target ?? '–', d.note || '–']))) : null,
      trainingList.length ? el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: t('history.workouts_per_week') }),
        barChart({ items: trainingTotals, unit: 'unit.workouts', label: t('history.workouts_chart') }),
        chartKey(t('history.key_all_workouts'), t('stats.at_goal'), t('history.target_key')),
        tableView([t('history.week'), t('stats.workouts'), t('history.target_key'), t('history.workouts_at_goal_head')], trainingTotals.map(d => [d.short, d.value ?? '–', d.target ?? '–', d.note || '–']))) : null,
      el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: t('history.steps_title') }),
        anySteps
          ? barChart({ items: stepItems, unit: 'unit.steps', refLine: stepGoal, refLabel: t('history.goal_ref', { value: compact(stepGoal) }), label: t('history.steps_chart') })
          : el('p', { class: 'panel-note', text: t('history.steps_empty') }),
        anySteps ? chartKey(t('history.key_steps'), t('stats.at_goal')) : null,
        anySteps ? tableView([t('history.week'), t('history.key_steps'), t('history.days_at_goal')], stepItems.map(d => [d.short, d.value == null ? '–' : number(d.value), d.note || '–'])) : null));
  }

  const SETTINGS_KINDS = new Set(['weekly_goal', 'group_target', 'step_goal', 'week_start']);
  // "Week 48 · 23–29 Nov" for Monday weeks; Sunday weeks have no number.
  function periodOf(day) {
    const ws = store.weekStart();
    const start = weekStartOf(day, ws), end = addDays(start, 6);
    return ws === 'sunday' ? range(start, end) : `${t('week.title', { n: isoWeekNumber(start) })} · ${range(start, end)}`;
  }

  function logPanel() {
    if (!logLoaded && !logLoading && !logError) queueMicrotask(() => loadLog(true));
    const days = [];
    for (const r of log) {
      const day = isoDate(new Date(r.happened_at));
      let d = days.at(-1);
      if (!d || d.day !== day) days.push((d = { day, rows: [] }));
      d.rows.push(r);
    }
    const items = days.map(d => el('section', { class: 'log-day' },
      el('h3', { class: 'label log-date', text: dayHeading(d.day) }),
      el('ul', { class: 'log-list' }, ...d.rows.map(r => {
        // The week each entry counts for: sets in their week, goal and target
        // changes from the week they took effect.
        const period = periodOf(r.local_date);
        const when = SETTINGS_KINDS.has(r.kind) ? t('log.from', { period }) : period;
        const from = r.source === 'ios' ? t('log.iphone') : r.source === 'import' ? t('log.imported') : '';
        return el('li', { class: `log-row kind-${r.kind}` },
          el('span', { class: 'log-time', text: time(r.happened_at) }),
          el('span', { class: 'log-text' }, el('span', { text: logText(r) }),
            el('span', { class: 'log-meta', text: [when, from].filter(Boolean).join(' · ') })),
          r.kind === 'set'
            ? el('button', { type: 'button', class: 'ibtn small', 'aria-label': t('log.remove_aria', { what: logText(r), time: time(r.happened_at) }), html: ICON.remove, onclick: () => removeSet(r) })
            : el('span', {}));
      }))));
    return el('section', { class: 'board panel log' },
      el('h2', { class: 'panel-title', text: t('log.title') }),
      el('p', { class: 'panel-note', text: t('log.note') }),
      ...items,
      logError ? el('p', { class: 'hint', text: t(logError.kind === 'network' ? 'log.offline' : 'log.load_failed') }) : null,
      !logLoading && logLoaded && !log.length ? el('p', { class: 'hint', text: t('log.empty') }) : null,
      el('div', { class: 'tray' },
        logLoading ? el('span', { class: 'muted small', text: t('app.loading') })
          : logError ? el('button', { type: 'button', class: 'tray-btn', text: t('common.try_again'), onclick: () => loadLog(log.length === 0) })
            : !logDone ? el('button', { type: 'button', class: 'tray-btn', text: t('log.older'), onclick: () => loadLog() }) : el('span', {})));
  }

  function draw() {
    const s = store.state;
    if (!s.settings) return;
    const tabs = el('div', { class: 'seg tabs-seg', role: 'tablist', 'aria-label': t('history.views') },
      el('button', { type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(tab === 'weeks'), text: t('history.weeks'), onclick: () => go('history') }),
      el('button', { type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(tab === 'log'), text: t('history.log'), onclick: () => go('history/log') }));
    root.replaceChildren(
      el('header', { class: 'top' },
        el('div', { class: 'week' }, el('p', { class: 'brand', text: '20/7' }), el('h1', { text: t('history.title') })),
        tabs),
      tab === 'weeks' ? weeksPanel() : logPanel());
    for (const c of root.querySelectorAll('.chart')) c.draw?.();
  }

  return {
    el: root,
    setTab(name) {
      tab = name === 'log' ? 'log' : 'weeks';
      if (tab === 'weeks') store.loadHistory();
      else if (logLoaded) loadLog(true);
      draw();
    },
    update: draw,
    afterUndo(item) {
      if (tab === 'log' && (item.type === 'removed' || item.type === 'entry')) loadLog(true);
    },
    destroy() { resize.disconnect(); },
  };
}
