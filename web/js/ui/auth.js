// Sign-in: email first, then the code from the email. A link in the email
// works too: it opens this page already signed in.
import { el, ICON, selectBox } from '../util.js';
import { classify } from '../api.js';
import { t, tParts, LANGUAGES, language, setLanguage } from '../i18n.js';

const PENDING = 'twentyseven.signin';      // { email, at }: survives the trip to the mail app
const CODE_TTL = 60 * 60 * 1000;
const RESEND_AFTER = 60;                   // seconds; Supabase refuses sooner

function readPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) || 'null');
    return p && Date.now() - p.at < CODE_TTL ? p : null;
  } catch { return null; }
}
let typed = '';                            // the email being typed, kept when the language changes
const writePending = p => { try { p ? localStorage.setItem(PENDING, JSON.stringify(p)) : localStorage.removeItem(PENDING); } catch { /* ignore */ } };

function explain(e) {
  const err = classify(e);
  switch (err.kind) {
    case 'invite_only': return t('auth.invite_only');
    case 'rate': {
      const s = /after (\d+) seconds?/i.exec(err.message || '');
      return s ? t('auth.wait', { n: Number(s[1]) }) : t('auth.rate');
    }
    case 'network': return t('auth.network');
    case 'bad_code': return t('auth.bad_code');
    default: return t('common.went_wrong', { message: err.message || t('common.unknown_error') });
  }
}

export function authView({ store }) {
  const pending = readPending();
  let step = pending ? 'code' : 'email';
  let email = pending?.email || typed;
  let sentAt = pending?.at || 0;
  let busy = false;
  const link = store.state.linkError;
  let message = link === 'expired' ? t('auth.link_expired') : link ? t('auth.link_failed') : '';
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
      oninput: () => { typed = input.value; },
    });
    const form = el('form', {
      class: 'auth-form', novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        email = input.value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) { message = t('auth.enter_email'); draw(); return; }
        send(form);
      },
    },
    el('label', { class: 'sr-only', for: 'auth-email', text: t('auth.email_label') }),
    input,
    el('button', { class: 'btn primary wide', type: 'submit', text: t('auth.send') }),
    message ? el('p', { class: 'form-msg', role: 'alert', text: message }) : null);
    queueMicrotask(() => input.focus());
    return el('div', { class: 'auth-card welcome' },
      el('h1', { class: 'hero', text: '20/7' }),
      el('p', { class: 'tagline', text: t('auth.tagline') }),
      el('ul', { class: 'welcome-list' },
        el('li', { text: t('auth.point_track') }),
        el('li', { text: t('auth.point_tap') }),
        el('li', { text: t('auth.point_goal') }),
        el('li', { text: t('auth.point_minimal') })),
      whyTwenty(),
      el('h2', { class: 'auth-title', text: t('auth.start') }),
      form,
      el('p', { class: 'muted small', text: t('auth.no_password') }),
      languagePicker());
  }

  // Before signing in there's no Settings, so the language can be picked here.
  function languagePicker() {
    const select = el('select', {
      class: 'select', id: 'auth-lang',
      onchange: () => setLanguage(select.value),
    }, ...LANGUAGES.map(([code, name]) => el('option', { value: code, selected: code === language(), lang: code, text: name })));
    return el('p', { class: 'lang-pick' },
      el('label', { class: 'sr-only', for: 'auth-lang', text: t('auth.language') }),
      el('span', { html: ICON.globe }),
      selectBox(select));
  }

  // The story behind the app and the number, one tap away.
  function whyTwenty() {
    const link = (text, href) => el('a', { href, target: '_blank', rel: 'noopener', text });
    return el('details', { class: 'why' },
      el('summary', { text: t('why.title') }),
      el('p', { text: t('why.story') }),
      el('p', { text: t('why.anything') }),
      el('p', { text: t('why.research') }),
      el('p', { class: 'why-sources' },
        link('Baz-Valle et al., 2022', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8884877/'), ' · ',
        link(`Pelland et al., 2024 (${t('why.preprint')})`, 'https://sportrxiv.org/index.php/server/preprint/download/460/967/908')),
      el('p', { text: t('why.joke') }));
  }

  function codeStep() {
    const input = el('input', {
      class: 'input code', id: 'auth-code', type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code',
      pattern: '[0-9]*', maxlength: '10', required: true, placeholder: t('auth.code_placeholder'),
    });
    const form = el('form', {
      class: 'auth-form', novalidate: true,
      onsubmit: async e => {
        e.preventDefault();
        const code = input.value.replace(/\D/g, '');
        if (code.length < 6) { message = t('auth.enter_code'); draw(); return; }
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
    el('label', { class: 'label', for: 'auth-code', text: t('auth.code_label') }),
    input,
    el('button', { class: 'btn primary wide', type: 'submit', text: t('auth.sign_in') }),
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
      type: 'button', class: 'link-btn', disabled: wait > 0, text: wait > 0 ? t('auth.send_again_in', { n: wait }) : t('auth.send_new'),
      onclick: () => send(form),
    });
    clearInterval(ticker);
    if (wait > 0) {
      ticker = setInterval(() => {
        const left = Math.max(0, RESEND_AFTER - Math.floor((Date.now() - sentAt) / 1000));
        again.textContent = left > 0 ? t('auth.send_again_in', { n: left }) : t('auth.send_new');
        again.disabled = left > 0;
        if (!left) clearInterval(ticker);
      }, 1000);
    }
    queueMicrotask(() => input.focus());
    return el('div', { class: 'auth-card' },
      el('p', { class: 'brand', text: '20/7' }),
      el('h1', { text: t('auth.check_email') }),
      el('p', { class: 'lead' }, tParts('auth.sent_to', { email: el('strong', { text: email }) })),
      form,
      el('p', { class: 'muted small', text: t('auth.got_link') }),
      el('div', { class: 'auth-links' },
        el('button', { type: 'button', class: 'link-btn', text: t('auth.other_email'), onclick: () => { writePending(null); step = 'email'; message = ''; draw(); } }),
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
