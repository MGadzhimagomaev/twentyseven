// A short guided tour: one control at a time is lit up, with a card that says what
// it does. The screen stays usable underneath, so the first set is logged for real.
import { el, fill } from '../util.js';

// steps: [{ id, target: () => Element | null, title, text }]
export function createTour(steps, { onEnd } = {}) {
  let i = 0;
  let ended = false;
  const spot = el('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const card = el('section', { class: 'tour-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-title' });
  document.body.append(spot, card);

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
      el('p', { class: 'tour-text', text: step.text }),
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
    if (!target) {
      spot.hidden = true;
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
