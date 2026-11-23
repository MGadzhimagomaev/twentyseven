// A short guided tour: one control at a time is lit up, with a card that says what
// it does. Everything else is shut off while it runs. Only the steps that ask for
// it (logging the first set for real, −, Undo) let the lit control be used.
import { el, fill } from '../util.js';

// steps: [{ id, target: () => Element | null, title, text: string or [strings and nodes] }]
export function createTour(steps, { onEnd, interactive = ['log', 'minus', 'undo'] } = {}) {
  let i = 0;
  let ended = false;
  const app = document.getElementById('app');
  const spot = el('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const card = el('section', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' });
  // Four see-through panels around the lit control catch clicks everywhere else;
  // a fifth covers the control itself on steps that only explain.
  const nudge = e => {
    e.preventDefault();
    e.stopPropagation();
    card.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  };
  const shields = Array.from({ length: 5 }, () => el('div', { class: 'tour-shield', 'aria-hidden': 'true', onpointerdown: nudge, onclick: nudge }));
  for (const sh of shields) Object.assign(sh.style, { position: 'fixed', zIndex: '30', left: '0', top: '0', width: '0', height: '0' });
  document.body.append(...shields, spot, card);
  const box = (sh, left, top, width, height) => Object.assign(sh.style, {
    left: `${left}px`, top: `${top}px`, width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px`,
  });

  const onMove = () => place(false);
  window.addEventListener('resize', onMove);
  window.addEventListener('scroll', onMove, { passive: true });

  function go(n) {
    if (ended) return;
    if (n >= steps.length) { end(); return; }
    i = Math.max(0, n);
    render();
  }

  function render() {
    const step = steps[i];
    const last = i === steps.length - 1;
    fill(card,
      el('p', { class: 'tour-count', text: `${i + 1} of ${steps.length}` }),
      el('h2', { class: 'tour-title', id: 'tour-title', text: step.title }),
      el('p', { class: 'tour-text' }, step.text),
      el('div', { class: 'tour-actions' },
        last ? el('span') : el('button', { type: 'button', class: 'link-btn', text: 'Skip tour', onclick: end }),
        el('div', { class: 'tour-nav' },
          i > 0 ? el('button', { type: 'button', class: 'btn', text: 'Back', onclick: () => go(i - 1) }) : null,
          el('button', { type: 'button', class: 'btn primary tour-next', text: last ? 'Done' : 'Next', onclick: () => go(i + 1) }))));
    place(true);
    card.querySelector('.tour-next')?.focus({ preventScroll: true });
  }

  // Lights up the step's control and puts the card below it, or above when
  // there's no room below. Called again whenever the screen redraws.
  function place(scroll) {
    if (ended) return;
    const target = steps[i].target();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const usable = interactive.includes(steps[i].id);
    // Keyboard and screen readers stay in the card unless the step needs the page.
    if (app) app.inert = !usable;
    if (!target) {
      spot.hidden = true;
      box(shields[0], 0, 0, vw, vh);
      for (const sh of shields.slice(1)) box(sh, 0, 0, 0, 0);
      Object.assign(card.style, { left: `${Math.max(12, (vw - card.offsetWidth) / 2)}px`, top: `${Math.max(12, (vh - card.offsetHeight) / 2)}px` });
      return;
    }
    if (scroll) {
      const r0 = target.getBoundingClientRect();
      if (r0.top < 70 || r0.bottom > vh - 200) target.scrollIntoView({ block: 'center' });
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.hidden = false;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const L = r.left - pad, T = r.top - pad, R = r.right + pad, B = r.bottom + pad;
    box(shields[0], 0, 0, vw, T);                 // above
    box(shields[1], 0, B, vw, vh - B);            // below
    box(shields[2], 0, T, L, B - T);              // left
    box(shields[3], R, T, vw - R, B - T);         // right
    box(shields[4], L, T, usable ? 0 : R - L, usable ? 0 : B - T);   // the control itself
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top = r.bottom + pad + 12;
    if (top + ch > vh - 12) top = r.top - pad - 12 - ch;
    top = Math.min(Math.max(12, top), vh - ch - 12);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  }

  function end() {
    if (ended) return;
    ended = true;
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove);
    spot.remove();
    card.remove();
    for (const sh of shields) sh.remove();
    if (app) app.inert = false;
    onEnd?.();
  }

  render();
  return {
    get step() { return ended ? null : steps[i]; },
    next: () => go(i + 1),
    place: () => place(false),
    end,
  };
}
