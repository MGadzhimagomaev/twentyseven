// Sign-in: email first, then the code from the email. A link in the email
// works too: it opens this page already signed in.
import { el } from '../util.js';
import { classify } from '../api.js';

const PENDING = 'twentyseven.signin';      // { email, at }: survives the trip to the mail app
const CODE_TTL = 60 * 60 * 1000;
const RESEND_AFTER = 60;                   // seconds; Supabase refuses sooner

function readPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) || 'null');
    return p && Date.now() - p.at < CODE_TTL ? p : null;
  } catch { return null; }
}
const writePending = p => { try { p ? localStorage.setItem(PENDING, JSON.stringify(p)) : localStorage.removeItem(PENDING); } catch { /* ignore */ } };

function explain(e) {
  const err = classify(e);
  switch (err.kind) {
    case 'invite_only': return '20/7 is invite-only for now. Ask for an invite, then try again.';
    case 'rate': {
      const s = /after (\d+) seconds?/i.exec(err.message || '');
      return s ? `Please wait ${s[1]} seconds, then try again.` : 'Too many sign-in emails right now. Try again in a while.';
    }
    case 'network': return 'No connection. Check your internet and try again.';
    case 'bad_code': return 'That code is wrong or has expired. Use the newest email, or send a new code.';
    default: return `Something went wrong: ${err.message || 'unknown error'}`;
  }
}

export function authView({ store }) {
  const pending = readPending();
  let step = pending ? 'code' : 'email';
  let email = pending?.email || '';
  let sentAt = pending?.at || 0;
  let busy = false;
  const link = store.state.linkError;
  let message = link === 'expired' ? 'That sign-in link has expired or was already used. Send a new one.'
    : link ? 'That sign-in link didn’t work. Send a new one.' : '';
  let ticker = 0;

  const root = el('main', { class: 'page auth' });

  function setBusy(form, on) {
    busy = on;
    for (const c of form.elements) c.disabled = on;
  }

  async function send(form) {
    if (busy) return;
    message = '';
    setBusy(form, true);
    try {
      await store.sendCode(email);
      sentAt = Date.now();
      writePending({ email, at: sentAt });
      step = 'code';
    } catch (e) {
      message = explain(e);
    }
    busy = false;
    draw();
  }

  function emailStep() {
    const input = el('input', {
      class: 'input', id: 'auth-email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email',
      required: true, placeholder: 'you@example.com', value: email, spellcheck: 'false', autocapitalize: 'off',
    });
    const form = el('form', {
      class: 'auth-form', novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        email = input.value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) { message = 'Enter your email address.'; draw(); return; }
        send(form);
      },
    },
    el('label', { class: 'sr-only', for: 'auth-email', text: 'Email' }),
    input,
    el('button', { class: 'btn primary wide', type: 'submit', text: 'Send sign-in email' }),
    message ? el('p', { class: 'form-msg', role: 'alert', text: message }) : null);
    queueMicrotask(() => input.focus());
    return el('div', { class: 'auth-card welcome' },
      el('h1', { class: 'hero', text: '20/7' }),
      el('p', { class: 'tagline', text: '20 sets for each muscle group, every 7 days.' }),
      el('ul', { class: 'welcome-list' },
        el('li', { text: 'Tap a group each time you finish a set. Gym or home, it all counts.' }),
        el('li', { text: 'Watch each group fill up over the week. Then it starts over.' }),
        el('li', { text: 'Pick your own goal, or one per group, and count workouts like runs too.' })),
      whyTwenty(),
      el('h2', { class: 'auth-title', text: 'Start with your email' }),
      form,
      el('p', { class: 'muted small', text: 'No password: we email you a code. New here? The same email creates your account.' }));
  }

  // The story behind the app and the number, one tap away.
  function whyTwenty() {
    const link = (text, href) => el('a', { href, target: '_blank', rel: 'noopener', text });
    return el('details', { class: 'why' },
      el('summary', { text: 'Why 20/7?' }),
      el('p', { text: 'I was struggling to keep track of all my different kinds of training in one place. Then I came across this approach by chance and tried it: count the sets each muscle group gets in a week, wherever they happen. It finally let me track everything together. I started in my notes, ended up building this app for myself, and now I’m sharing it in case it helps someone else. It’s minimal on purpose.' }),
      el('p', {},
        'Research points the same way. A 2022 review suggests 12–20 sets per muscle a week as a good target for growth, ',
        'and a 2024 analysis found that more sets keep helping, just a little less each time.'),
      el('p', { class: 'why-sources' },
        link('Baz-Valle et al., 2022', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8884877/'), ' · ',
        link('Pelland et al., 2024 (preprint)', 'https://sportrxiv.org/index.php/server/preprint/download/460/967/908')),
      el('p', { text: 'If the research ever changes its mind, I’ll rename the app. Until then, 20 works for me.' }));
  }

  function codeStep() {
    const input = el('input', {
      class: 'input code', id: 'auth-code', type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code',
      pattern: '[0-9]*', maxlength: '10', required: true, placeholder: 'Code',
    });
    const form = el('form', {
      class: 'auth-form', novalidate: true,
      onsubmit: async e => {
        e.preventDefault();
        const code = input.value.replace(/\D/g, '');
        if (code.length < 6) { message = 'Enter the whole code from the email.'; draw(); return; }
        if (busy) return;
        message = '';
        setBusy(form, true);
        try {
          await store.verifyCode(email, code);
          writePending(null);       // signed in: the app takes over from here
        } catch (err) {
          busy = false;
          message = explain(err);
          draw();
        }
      },
    },
    el('label', { class: 'label', for: 'auth-code', text: 'Code from the email' }),
    input,
    el('button', { class: 'btn primary wide', type: 'submit', text: 'Sign in' }),
    message ? el('p', { class: 'form-msg', role: 'alert', text: message }) : null);
    // Codes can be 6 to 10 digits, so typing never sends early. A code pasted or
    // filled in from the email arrives all at once and is sent straight away.
    let before = '';
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '');
      if (digits !== input.value) input.value = digits;
      const typed = digits.startsWith(before) && digits.length - before.length <= 1;
      before = digits;
      if (digits.length >= 6 && !typed && !busy) form.requestSubmit();
    });

    const wait = Math.max(0, RESEND_AFTER - Math.floor((Date.now() - sentAt) / 1000));
    const again = el('button', {
      type: 'button', class: 'link-btn', disabled: wait > 0, text: wait > 0 ? `Send again in ${wait}s` : 'Send a new code',
      onclick: () => send(form),
    });
    clearInterval(ticker);
    if (wait > 0) {
      ticker = setInterval(() => {
        const left = Math.max(0, RESEND_AFTER - Math.floor((Date.now() - sentAt) / 1000));
        again.textContent = left > 0 ? `Send again in ${left}s` : 'Send a new code';
        again.disabled = left > 0;
        if (!left) clearInterval(ticker);
      }, 1000);
    }
    queueMicrotask(() => input.focus());
    return el('div', { class: 'auth-card' },
      el('p', { class: 'brand', text: '20/7' }),
      el('h1', { text: 'Check your email' }),
      el('p', { class: 'lead' }, 'We sent a sign-in email to ', el('strong', { text: email }), '.'),
      form,
      el('p', { class: 'muted small', text: 'Got a link instead of a code? Open it on this device.' }),
      el('div', { class: 'auth-links' },
        el('button', { type: 'button', class: 'link-btn', text: 'Use another email', onclick: () => { writePending(null); step = 'email'; message = ''; draw(); } }),
        again));
  }

  function draw() {
    root.replaceChildren(step === 'email' ? emailStep() : codeStep());
  }
  draw();

  return {
    el: root,
    destroy() { clearInterval(ticker); },
  };
}
