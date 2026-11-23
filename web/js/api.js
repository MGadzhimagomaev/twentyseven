// Everything the app asks of the backend. The Supabase version is used unless a
// test has put a stand-in on window.__TWENTYSEVEN_API__.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export class ApiError extends Error {
  // kind: 'network' | 'auth' | 'rate' | 'invite_only' | 'bad_code' | 'denied' | 'other'
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind;
    this.cause = cause;
  }
}

export function classify(error, status = undefined) {
  if (error instanceof ApiError) return error;
  const code = String(error?.code || error?.error_code || '');
  const st = status ?? error?.status;
  const msg = String(error?.message || error || 'Unknown error');
  if (error?.name === 'AuthRetryableFetchError' || st === 0 || /Failed to fetch|NetworkError|Load failed|fetch failed|ERR_INTERNET|network/i.test(msg)) {
    return new ApiError('network', 'No connection', error);
  }
  if (code === 'signup_disabled' || /signups? not allowed/i.test(msg)) return new ApiError('invite_only', msg, error);
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || st === 429 || /rate limit|only request this after/i.test(msg)) {
    return new ApiError('rate', msg, error);
  }
  if (code === 'otp_expired' || /expired or is invalid|token has expired/i.test(msg)) return new ApiError('bad_code', msg, error);
  if (st === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(msg)) return new ApiError('auth', msg, error);
  if (code === '42501' || /permission denied|row-level security/i.test(msg)) return new ApiError('denied', msg, error);
  return new ApiError('other', msg, error);
}

const toUser = u => (u ? { id: u.id, email: u.email } : null);

function supabaseApi() {
  if (!window.supabase?.createClient) throw new ApiError('other', 'The Supabase library did not load.');
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'twentyseven.auth' },
  });
  let uid = null;

  async function run(query) {
    let res;
    try {
      res = await query;
    } catch (e) {
      throw classify(e, 0);
    }
    if (res.error) throw classify(res.error, res.status);
    return res.data;
  }

  // Reads every row of a query, 1000 at a time.
  async function all(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await run(build().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  return {
    async session() {
      const { data, error } = await sb.auth.getSession();
      if (error) throw classify(error);
      uid = data.session?.user?.id ?? null;
      return toUser(data.session?.user);
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event, session) => {
        uid = session?.user?.id ?? null;
        cb(event, toUser(session?.user));
      });
    },
    // Sends the sign-in email: a 6-digit code once the template has one, otherwise a
    // link that brings the person back to this page signed in.
    async sendCode(email) {
      const emailRedirectTo = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo } });
      if (error) throw classify(error);
    },
    async verifyCode(email, token) {
      const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw classify(error);
      uid = data.user?.id ?? null;
      return toUser(data.user);
    },
    // Signs out this device only; other phones and browsers stay signed in.
    async signOut() {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      uid = null;
    },

    loadSettings: () => run(sb.from('settings').select('*').maybeSingle()),
    createSettings: () => run(sb.from('settings').upsert({ user_id: uid }, { onConflict: 'user_id', ignoreDuplicates: true })),
    saveSettings: patch => run(sb.from('settings').update(patch).eq('user_id', uid)),

    loadGroups: () => run(sb.from('muscle_groups').select('id,name,position,own_target,archived_at,created_at').order('position')),
    // Rows always carry every column, so an upsert never trips a NOT NULL check.
    saveGroups: rows => run(sb.from('muscle_groups').upsert(rows.map(r => ({ ...r, user_id: uid })), { onConflict: 'user_id,id' })),

    loadEntries: fromDate => all(() => sb.from('set_entries').select('id,group_id,delta,local_date,logged_at,source').gte('local_date', fromDate).order('logged_at')),
    // An entry that already arrived is skipped, so retries never count twice.
    addEntries: rows => run(sb.from('set_entries').upsert(rows.map(r => ({ ...r, user_id: uid })), { onConflict: 'id', ignoreDuplicates: true })),
    deleteEntry: id => run(sb.from('set_entries').delete().eq('id', id)),

    loadSteps: fromDate => run(sb.from('daily_steps').select('day,steps').gte('day', fromDate)),
    weeklyProgress: weeks => run(sb.rpc('weekly_progress', { weeks })),
    weeklySteps: weeks => run(sb.rpc('weekly_steps', { weeks })),
    activityLog: (offset, limit) => run(
      sb.from('activity_log')
        .select('kind,ref,group_id,group_name,old_value,new_value,source,local_date,happened_at')
        .order('happened_at', { ascending: false })
        .range(offset, offset + limit - 1)),

    async exportAll() {
      return {
        settings: await run(sb.from('settings').select('*').maybeSingle()),
        groups: await all(() => sb.from('muscle_groups').select('*').order('position')),
        sets: await all(() => sb.from('set_entries').select('*').order('logged_at')),
        steps: await all(() => sb.from('daily_steps').select('*').order('day')),
        changes: await all(() => sb.from('changes').select('*').order('changed_at')),
      };
    },
    async deleteAccount() {
      await run(sb.rpc('delete_my_account'));
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      uid = null;
    },
  };
}

export function createApi() {
  return window.__TWENTYSEVEN_API__ || supabaseApi();
}
