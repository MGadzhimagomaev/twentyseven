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
    el('label', { class: 'label', for: 'auth-email', text: 'Email' }),
    input,
    el('button', { class: 'btn primary wide', type: 'submit', text: 'Send sign-in email' }),
    message ? el('p', { class: 'form-msg', role: 'alert', text: message }) : null);
    queueMicrotask(() => input.focus());
    return el('div', { class: 'auth-card' },
      el('p', { class: 'brand', text: '20/7' }),
      el('h1', { text: 'Sign in' }),
      el('p', { class: 'lead', text: 'Count your sets for each muscle group, every week. No password: we email you a code.' }),
      form);
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
