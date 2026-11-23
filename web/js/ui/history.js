// History: the last 12 weeks as a grid of groups by week, sets per week against the
// target, steps per week, and one group at a time. The Log lists every action,
// newest first, and a mistaken set can be removed from it.
import { el, ICON, compact, number, range, dayMonth, weekday, time, isoDate, addDays, plural } from '../util.js';
import { weekTitle, isoWeekNumber } from '../week.js';
import { WEEKS_KEPT } from '../store.js';

const DAY_NAME = { monday: 'Monday', sunday: 'Sunday' };

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
    const [one, many] = Array.isArray(unit) ? unit : [unit, unit];
    const bits = [d.title, d.value == null ? 'no data' : `${fmt(d.value)} ${d.value === 1 ? one : many}`];
    if (d.target != null) bits.push(`target ${fmt(d.target)}`);
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
        svg += `<path class="bar" data-i="${i}" d="M${x} ${y0}V${yt + r}Q${x} ${yt} ${x + r} ${yt}H${x + bw - r}Q${x + bw} ${yt} ${x + bw} ${yt + r}V${y0}Z"/>`;
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

function tableView(head, rows) {
  return el('details', { class: 'table-view' },
    el('summary', { text: 'Show as a table' }),
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
    case 'weekly_goal': return `Weekly goal ${r.old_value} → ${r.new_value}`;
    case 'step_goal': return `Step goal ${number(Number(r.old_value))} → ${number(Number(r.new_value))}`;
    case 'week_start': return `Weeks now start on ${DAY_NAME[r.new_value] || r.new_value}`;
    case 'group_target':
      if (r.new_value == null) return `${name} follows the weekly goal again`;
      if (r.old_value == null) return `${name} gets its own target: ${r.new_value}`;
      return `${name} target ${r.old_value} → ${r.new_value}`;
    case 'group_added': return `Added ${r.new_value || name}`;
    case 'group_renamed': return `Renamed ${r.old_value} to ${r.new_value}`;
    case 'group_removed': return `Removed ${name}`;
    case 'group_restored': return `Brought back ${name}`;
    default: return r.kind;
  }
}

function dayHeading(day) {
  const today = isoDate();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return `${weekday(day)} ${dayMonth(day)}`;
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
    toast(`${logText(r)} removed`, { action: 'Undo', onAction: () => { undo(); } });
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
        el('p', { class: 'hint', text: s.historyError ? (s.historyError.kind === 'network' ? 'History needs a connection the first time.' : 'Couldn’t load history.') : 'Loading history…' }),
        s.historyError ? el('div', { class: 'tray' }, el('button', { type: 'button', class: 'tray-btn', text: 'Try again', onclick: () => store.loadHistory(true) })) : null);
    }
    const weeks = axisWeeks();
    const ws = store.weekStart();
    const titleOf = w => weekTitle({ start: w, end: addDays(w, 6), weekStart: ws, number: isoWeekNumber(w) });
    const groups = new Map();
    for (const r of rows) {
      let g = groups.get(r.group_id);
      if (!g) groups.set(r.group_id, (g = { id: r.group_id, name: r.group_name, position: r.position, archived: r.archived, cells: new Map() }));
      g.cells.set(r.week_start, r);
    }
    const list = [...groups.values()].sort((a, b) => (a.archived - b.archived) || (a.position - b.position));
    if (!list.length) {
      return el('section', { class: 'board panel' }, el('p', { class: 'hint', text: 'Nothing yet. Your weeks show up here once you log sets.' }));
    }

    // Groups by week.
    const label = w => `${dayMonth(w)}`;
    const head = el('div', { class: 'heat-row heat-head', 'aria-hidden': 'true' }, el('span', {}),
      ...weeks.map((w, i) => el('span', { class: 'heat-x', text: (WEEKS_KEPT - 1 - i) % 3 === 0 ? label(w) : '' })));
    const heat = el('div', { class: 'heat', style: `--cols:${weeks.length}` },
      ...list.map(g => el('div', { class: 'heat-row' },
        el('button', {
          type: 'button', class: selected === g.id ? 'heat-name on' : 'heat-name', 'aria-pressed': String(selected === g.id),
          title: g.archived ? `${g.name} (removed)` : `${g.name}, week by week`, onclick: () => { selected = selected === g.id ? null : g.id; draw(); },
          'aria-label': g.archived ? `${g.name} (removed), week by week` : `${g.name}, week by week`,
        }, el('span', { class: g.archived ? 'removed' : null, text: g.name })),
        ...weeks.map(w => {
          const c = g.cells.get(w);
          if (!c) return el('span', { class: 'hc none', 'aria-hidden': 'true' });
          const lv = levelOf(c.sets, c.target);
          const text = `${g.name}, ${range(w, addDays(w, 6))}: ${c.sets} of ${c.target} sets`;
          const show = () => { cellNote = text; const n = root.querySelector('.heat-note'); if (n) n.textContent = text; };
          return el('button', {
            type: 'button', class: 'hc', 'data-l': String(lv), 'aria-label': text,
            html: lv === 5 ? ICON.tick : '', onclick: show, onpointerenter: show, onfocus: show,
          });
        }))),
      head);
    const legend = el('div', { class: 'heat-legend', 'aria-hidden': 'true' },
      el('span', { text: 'Share of target' }),
      ...[1, 2, 3, 4].map(l => el('span', { class: 'hc', 'data-l': String(l) })),
      el('span', { class: 'hc', 'data-l': '5', html: ICON.tick }), el('span', { text: 'at goal' }));
    const heatTable = tableView(['Group', ...weeks.map(label)],
      list.map(g => [g.name + (g.archived ? ' (removed)' : ''), ...weeks.map(w => { const c = g.cells.get(w); return c ? `${c.sets}/${c.target}` : '–'; })]));

    // One group, week by week.
    let groupPanel = null;
    const sel = selected && groups.get(selected);
    if (sel) {
      const items = weeks.map(w => {
        const c = sel.cells.get(w);
        return { title: titleOf(w), short: label(w), value: c ? c.sets : null, target: c ? c.target : null };
      });
      groupPanel = el('section', { class: 'board panel' },
        el('div', { class: 'panel-head' },
          el('h2', { class: 'panel-title', text: `${sel.name}, week by week` }),
          el('button', { type: 'button', class: 'ibtn', 'aria-label': 'Close', html: ICON.close, onclick: () => { selected = null; draw(); } })),
        barChart({ items, unit: ['set', 'sets'], label: `${sel.name}: sets per week against its target` }),
        el('p', { class: 'chart-key' }, el('span', { class: 'key-bar' }), 'Sets ', el('span', { class: 'key-line' }), 'Target'),
        tableView(['Week', 'Sets', 'Target'], items.map(d => [d.short, d.value ?? '–', d.target ?? '–'])));
    }

    // All groups together.
    const totals = weeks.map(w => {
      let sets = 0, target = 0, done = 0, n = 0;
      for (const g of list) {
        const c = g.cells.get(w);
        if (!c) continue;
        sets += c.sets; target += c.target; n++;
        if (c.sets >= c.target) done++;
      }
      return { title: titleOf(w), short: label(w), value: n ? sets : null, target: n ? target : null, note: n ? `${done} of ${n} groups at goal` : '' };
    });

    // Steps, from the iPhone app.
    const stepRows = new Map((s.history.steps || []).map(r => [r.week_start, r]));
    const anySteps = [...stepRows.values()].some(r => Number(r.days_logged) > 0);
    const stepGoal = s.settings.step_goal;
    const stepItems = weeks.map(w => {
      const r = stepRows.get(w);
      const days = r ? Number(r.days_logged) : 0;
      return {
        title: titleOf(w), short: label(w), value: days ? Math.round(Number(r.avg_steps)) : null,
        note: days ? `goal reached on ${plural(Number(r.days_at_goal), 'day', 'days')} of ${days}` : '',
      };
    });

    return el('div', { class: 'stack' },
      el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: 'Groups by week' }),
        el('p', { class: 'panel-note', text: 'Each square is one week. Darker means closer to the target. Tap a group for its own chart.' }),
        heat,
        el('p', { class: 'readout heat-note', 'aria-live': 'polite', text: cellNote || 'Tap a square to see its count.' }),
        legend,
        heatTable),
      groupPanel,
      el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: 'Sets per week' }),
        barChart({ items: totals, unit: ['set', 'sets'], label: 'Total sets per week against the total target' }),
        el('p', { class: 'chart-key' }, el('span', { class: 'key-bar' }), 'Sets, all groups ', el('span', { class: 'key-line' }), 'Target'),
        tableView(['Week', 'Sets', 'Target', 'Groups at goal'], totals.map(d => [d.short, d.value ?? '–', d.target ?? '–', d.note || '–']))),
      el('section', { class: 'board panel' },
        el('h2', { class: 'panel-title', text: 'Steps per day, weekly average' }),
        anySteps
          ? barChart({ items: stepItems, unit: ['step a day', 'steps a day'], refLine: stepGoal, refLabel: `Goal ${compact(stepGoal)}`, label: 'Average steps per day for each week' })
          : el('p', { class: 'panel-note', text: 'Steps come from the iPhone app. They show here once it has synced.' }),
        anySteps ? tableView(['Week', 'Steps a day', 'Days at goal'], stepItems.map(d => [d.short, d.value == null ? '–' : number(d.value), d.note || '–'])) : null));
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
        const counts = r.kind === 'set' && r.local_date !== d.day ? `counts for ${weekday(r.local_date)} ${dayMonth(r.local_date)}` : '';
        const from = r.kind === 'set' && r.source === 'ios' ? 'iPhone' : r.kind === 'set' && r.source === 'import' ? 'imported' : '';
        return el('li', { class: `log-row kind-${r.kind}` },
          el('span', { class: 'log-time', text: time(r.happened_at) }),
          el('span', { class: 'log-text' }, el('span', { text: logText(r) }),
            counts || from ? el('span', { class: 'log-meta', text: [from, counts].filter(Boolean).join(' · ') }) : null),
          r.kind === 'set'
            ? el('button', { type: 'button', class: 'ibtn small', 'aria-label': `Remove ${logText(r)} from ${time(r.happened_at)}`, html: ICON.remove, onclick: () => removeSet(r) })
            : el('span', {}));
      }))));
    return el('section', { class: 'board panel log' },
      el('h2', { class: 'panel-title', text: 'Activity' }),
      el('p', { class: 'panel-note', text: 'Every change, newest first. Remove a set logged by mistake with ×.' }),
      ...items,
      logError ? el('p', { class: 'hint', text: logError.kind === 'network' ? 'The log needs a connection.' : 'Couldn’t load the log.' }) : null,
      !logLoading && logLoaded && !log.length ? el('p', { class: 'hint', text: 'Nothing here yet.' }) : null,
      el('div', { class: 'tray' },
        logLoading ? el('span', { class: 'muted small', text: 'Loading…' })
          : logError ? el('button', { type: 'button', class: 'tray-btn', text: 'Try again', onclick: () => loadLog(log.length === 0) })
            : !logDone ? el('button', { type: 'button', class: 'tray-btn', text: 'Show older', onclick: () => loadLog() }) : el('span', {})));
  }

  function draw() {
    const s = store.state;
    if (!s.settings) return;
    const tabs = el('div', { class: 'seg tabs-seg', role: 'tablist', 'aria-label': 'History views' },
      el('button', { type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(tab === 'weeks'), text: 'Weeks', onclick: () => go('history') }),
      el('button', { type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(tab === 'log'), text: 'Log', onclick: () => go('history/log') }));
    root.replaceChildren(
      el('header', { class: 'top' },
        el('div', { class: 'week' }, el('p', { class: 'brand', text: '20/7' }), el('h1', { text: 'History' })),
        tabs),
      tab === 'weeks' ? weeksPanel() : logPanel());
    for (const c of root.querySelectorAll('.chart')) c.draw?.();
  }

  return {
    el: root,
    setTab(t) {
      tab = t === 'log' ? 'log' : 'weeks';
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
