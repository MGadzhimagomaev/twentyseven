// Five-bar tally gates: faint pencil strokes for the target, marker strokes for
// sets done, orange for sets past the target. The same index and seed always
// draw the same line, so marks never jump between redraws.

function rand(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const jit = (s, k, amp) => (rand(s + k) - 0.5) * 2 * amp;
const r2 = v => Math.round(v * 100) / 100;

export function strokePath(i, seed) {
  const k = i % 5, s = seed + i * 31;
  let x1, y1, x2, y2;
  if (k < 4) {
    const x = 4.5 + 5 * k;
    x1 = x + jit(s, 1, 0.45); y1 = 2.6 + jit(s, 2, 0.7);
    x2 = x + jit(s, 3, 0.55); y2 = 19.4 + jit(s, 4, 0.6);
  } else {
    x1 = 1.4 + jit(s, 1, 0.5); y1 = 16.4 + jit(s, 2, 0.8);
    x2 = 24.6 + jit(s, 3, 0.5); y2 = 5.4 + jit(s, 4, 0.8);
  }
  const cx = (x1 + x2) / 2 + jit(s, 5, 0.7), cy = (y1 + y2) / 2 + jit(s, 6, 0.5);
  return `M${r2(x1)} ${r2(y1)}Q${r2(cx)} ${r2(cy)} ${r2(x2)} ${r2(y2)}`;
}

export function tallySVG(n, goal, seed, fresh) {
  const total = Math.max(n, goal), bundles = Math.ceil(total / 5);
  let html = '';
  for (let b = 0; b < bundles; b++) {
    let ghost = '', ink = '';
    for (let k = 0; k < 5; k++) {
      const i = b * 5 + k;
      if (i >= total) break;
      const d = strokePath(i, seed);
      if (i < goal) ghost += `<path d="${d}"/>`;
      if (i < n) {
        const cls = [i >= goal ? 'x' : '', i === fresh ? 'fresh' : ''].filter(Boolean).join(' ');
        ink += `<path pathLength="1" d="${d}"${cls ? ` class="${cls}"` : ''}/>`;
      }
    }
    html += `<svg class="gate" viewBox="0 0 26 22" aria-hidden="true">${ghost ? `<g class="g">${ghost}</g>` : ''}${ink ? `<g class="i">${ink}</g>` : ''}</svg>`;
  }
  return html;
}
