-- 20/7 database, version 1.
-- Run once in Supabase › SQL Editor (or `supabase db push`).
--
-- Model: every set tap is its own row (+1 or -1), so history, charts and the
-- activity log are queries over one log. Changes to the weekly goal, a group's
-- own target, the step goal and the week start are written to `changes` by
-- triggers, so each past week keeps the targets it had.
-- Row-level security limits every table to the signed-in person's own rows.

-- ===== Helpers ==============================================================

-- First day of the week that contains `d`, for weeks starting on Monday or Sunday.
create or replace function public.week_start_of(d date, week_start text)
returns date
language sql
immutable
set search_path = ''
as $$
  select d - ((extract(isodow from d)::int
               - case when week_start = 'sunday' then 7 else 1 end + 7) % 7)
$$;

-- ===== Tables ===============================================================

create table public.settings (
  user_id             uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  bundle              text not null default 'extended'
                        check (bundle in ('ppl', 'classic', 'extended', 'detailed', 'custom')),
  week_start          text not null default 'monday' check (week_start in ('monday', 'sunday')),
  weekly_goal         smallint not null default 20 check (weekly_goal between 1 and 50),
  step_goal           integer not null default 10000 check (step_goal between 1000 and 50000),
  show_steps_on_sets  boolean not null default false,
  time_zone           text not null default 'Europe/Berlin' check (char_length(time_zone) between 1 and 64),
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.muscle_groups (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null check (id ~ '^[a-z0-9_-]{1,40}$'),
  name         text not null check (char_length(name) between 1 and 24),
  position     smallint not null default 0,
  own_target   smallint check (own_target between 1 and 50),  -- null: follows the weekly goal
  archived_at  timestamptz,                                    -- removed from the list, history kept
  created_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.set_entries (
  id          uuid primary key,                -- made on the device, so a retried sync can't double count
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id    text not null,
  delta       smallint not null,
  local_date  date not null,                   -- the person's own calendar date when it was logged
  logged_at   timestamptz not null default now(),
  source      text not null default 'web' check (source in ('web', 'ios', 'import')),
  check (delta <> 0 and delta between -999 and 999),
  check (source = 'import' or delta in (-1, 1)),
  foreign key (user_id, group_id) references public.muscle_groups (user_id, id) on delete cascade
);
create index set_entries_user_date on public.set_entries (user_id, local_date);

create table public.daily_steps (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  steps       integer not null check (steps between 0 and 200000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

-- Written only by the triggers below; people can read their own rows.
create table public.changes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in (
                'weekly_goal', 'group_target', 'step_goal', 'week_start',
                'group_added', 'group_renamed', 'group_removed', 'group_restored')),
  group_id    text,
  old_value   text,
  new_value   text,          -- for group_target: null means "follows the weekly goal again"
  local_date  date not null, -- '-infinity' marks the starting value, which covers all earlier weeks
  changed_at  timestamptz not null default now()
);
create index changes_user_time on public.changes (user_id, changed_at desc);
create index changes_targets on public.changes (user_id, kind, group_id, local_date desc);

-- ===== Change log triggers ==================================================

-- Today's date in the person's time zone (UTC if the stored zone is unknown).
create or replace function public.local_today(uid uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text;
begin
  select s.time_zone into tz from public.settings s where s.user_id = uid;
  return (now() at time zone coalesce(tz, 'UTC'))::date;
exception when others then
  return (now() at time zone 'UTC')::date;
end;
$$;

create or replace function public.log_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date;
begin
  -- An unknown time zone would break date math later, so fall back to UTC.
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.time_zone) then
    new.time_zone := 'UTC';
  end if;

  if tg_op = 'INSERT' then
    insert into public.changes (user_id, kind, new_value, local_date)
    values (new.user_id, 'weekly_goal', new.weekly_goal::text, '-infinity'),
           (new.user_id, 'step_goal', new.step_goal::text, '-infinity');
    return new;
  end if;

  today := public.local_today(new.user_id);
  if new.weekly_goal is distinct from old.weekly_goal then
    insert into public.changes (user_id, kind, old_value, new_value, local_date)
    values (new.user_id, 'weekly_goal', old.weekly_goal::text, new.weekly_goal::text, today);
  end if;
  if new.step_goal is distinct from old.step_goal then
    insert into public.changes (user_id, kind, old_value, new_value, local_date)
    values (new.user_id, 'step_goal', old.step_goal::text, new.step_goal::text, today);
  end if;
  if new.week_start is distinct from old.week_start then
    insert into public.changes (user_id, kind, old_value, new_value, local_date)
    values (new.user_id, 'week_start', old.week_start, new.week_start, today);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger settings_log
  before insert or update on public.settings
  for each row execute function public.log_settings_change();

create or replace function public.log_group_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.local_today(new.user_id);
  set_up boolean;
begin
  if tg_op = 'INSERT' then
    -- Groups created during first-launch setup are not activity worth listing.
    select s.onboarded_at is not null into set_up from public.settings s where s.user_id = new.user_id;
    if coalesce(set_up, false) then
      insert into public.changes (user_id, kind, group_id, new_value, local_date)
      values (new.user_id, 'group_added', new.id, new.name, today);
    end if;
    if new.own_target is not null then
      insert into public.changes (user_id, kind, group_id, new_value, local_date)
      values (new.user_id, 'group_target', new.id, new.own_target::text, today);
    end if;
    return new;
  end if;

  if new.name is distinct from old.name then
    insert into public.changes (user_id, kind, group_id, old_value, new_value, local_date)
    values (new.user_id, 'group_renamed', new.id, old.name, new.name, today);
  end if;
  if new.own_target is distinct from old.own_target then
    insert into public.changes (user_id, kind, group_id, old_value, new_value, local_date)
    values (new.user_id, 'group_target', new.id, old.own_target::text, new.own_target::text, today);
  end if;
  if new.archived_at is distinct from old.archived_at then
    insert into public.changes (user_id, kind, group_id, new_value, local_date)
    values (new.user_id,
            case when new.archived_at is null then 'group_restored' else 'group_removed' end,
            new.id, new.name, today);
  end if;
  return new;
end;
$$;

create trigger muscle_groups_log
  after insert or update on public.muscle_groups
  for each row execute function public.log_group_change();

-- Every new account gets its settings row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== Row-level security ===================================================

alter table public.settings      enable row level security;
alter table public.muscle_groups enable row level security;
alter table public.set_entries   enable row level security;
alter table public.daily_steps   enable row level security;
alter table public.changes       enable row level security;

create policy "read own settings"   on public.settings for select to authenticated using (user_id = (select auth.uid()));
create policy "add own settings"    on public.settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "change own settings" on public.settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "read own groups"   on public.muscle_groups for select to authenticated using (user_id = (select auth.uid()));
create policy "add own groups"    on public.muscle_groups for insert to authenticated with check (user_id = (select auth.uid()));
create policy "change own groups" on public.muscle_groups for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Sets are never edited: undo adds a -1 row, and a mistaken row can be deleted from the log.
create policy "read own sets"   on public.set_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "add own sets"    on public.set_entries for insert to authenticated with check (user_id = (select auth.uid()));
create policy "remove own sets" on public.set_entries for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own steps"   on public.daily_steps for select to authenticated using (user_id = (select auth.uid()));
create policy "add own steps"    on public.daily_steps for insert to authenticated with check (user_id = (select auth.uid()));
create policy "change own steps" on public.daily_steps for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "read own changes" on public.changes for select to authenticated using (user_id = (select auth.uid()));

-- Access is granted table by table, so this works whether or not the project
-- grants API access to new tables automatically. Signed-out visitors get nothing.
revoke all on public.settings, public.muscle_groups, public.set_entries, public.daily_steps, public.changes from anon, authenticated;
grant select, insert, update on public.settings      to authenticated;
grant select, insert, update on public.muscle_groups to authenticated;
grant select, insert, delete on public.set_entries   to authenticated;
grant select, insert, update on public.daily_steps   to authenticated;
grant select                 on public.changes       to authenticated;
grant execute on function public.week_start_of(date, text) to authenticated;

-- ===== Reading history ======================================================

-- One row per group per week for the last `weeks` weeks (the current one first):
-- sets logged, the target in force at the end of that week, and whether it was met.
-- Includes every group that was on the list that week, so empty cells show as 0.
create or replace function public.weekly_progress(weeks int default 12)
returns table (
  week_start  date,
  week_end    date,
  group_id    text,
  group_name  text,
  "position"  smallint,
  archived    boolean,
  sets        int,
  target      int,
  at_goal     boolean
)
language sql
stable
set search_path = ''
as $$
  with me as (
    select s.user_id, s.week_start as ws,
           public.week_start_of((now() at time zone s.time_zone)::date, s.week_start) as this_week
    from public.settings s
    where s.user_id = (select auth.uid())
  ),
  wk as (
    select me.user_id, me.ws, (me.this_week - 7 * n)::date as week_start
    from me, generate_series(0, least(greatest(weeks, 1), 260) - 1) as n
  ),
  sums as (
    select e.group_id, public.week_start_of(e.local_date, me.ws) as week_start, sum(e.delta)::int as sets
    from public.set_entries e
    join me on me.user_id = e.user_id
    where e.local_date >= (select min(wk.week_start) from wk)
    group by 1, 2
  ),
  cells as (
    select wk.user_id, wk.week_start, g.id as group_id, g.name as group_name, g.position,
           g.archived_at is not null as archived, coalesce(sm.sets, 0) as sets
    from wk
    join public.muscle_groups g on g.user_id = wk.user_id
    left join sums sm on sm.group_id = g.id and sm.week_start = wk.week_start
    where sm.sets is not null
       or ((g.archived_at is null or (g.archived_at at time zone 'UTC')::date > wk.week_start)
           and (g.created_at at time zone 'UTC')::date <= wk.week_start + 6)
  )
  select c.week_start, (c.week_start + 6)::date, c.group_id, c.group_name, c.position, c.archived,
         greatest(c.sets, 0), t.target, greatest(c.sets, 0) >= t.target
  from cells c
  cross join lateral (
    select coalesce(
      (select nullif(ch.new_value, '')::int
         from public.changes ch
        where ch.user_id = c.user_id and ch.kind = 'group_target' and ch.group_id = c.group_id
          and ch.local_date <= c.week_start + 6
        order by ch.local_date desc, ch.id desc
        limit 1),
      (select ch.new_value::int
         from public.changes ch
        where ch.user_id = c.user_id and ch.kind = 'weekly_goal'
          and ch.local_date <= c.week_start + 6
        order by ch.local_date desc, ch.id desc
        limit 1),
      20) as target
  ) t
  order by c.week_start desc, c.position, c.group_id
$$;

-- Steps per week for the last `weeks` weeks: average over days with steps,
-- and how many of those days reached the step goal in force that day.
create or replace function public.weekly_steps(weeks int default 12)
returns table (
  week_start    date,
  avg_steps     int,
  days_logged   int,
  days_at_goal  int
)
language sql
stable
set search_path = ''
as $$
  with me as (
    select s.user_id, s.week_start as ws,
           public.week_start_of((now() at time zone s.time_zone)::date, s.week_start) as this_week
    from public.settings s
    where s.user_id = (select auth.uid())
  ),
  days as (
    select d.day, d.steps, public.week_start_of(d.day, me.ws) as week_start,
           (select ch.new_value::int
              from public.changes ch
             where ch.user_id = me.user_id and ch.kind = 'step_goal' and ch.local_date <= d.day
             order by ch.local_date desc, ch.id desc
             limit 1) as goal
    from public.daily_steps d
    join me on me.user_id = d.user_id
    where d.steps > 0
      and d.day >= me.this_week - 7 * (least(greatest(weeks, 1), 260) - 1)
  )
  select days.week_start, round(avg(days.steps))::int, count(*)::int,
         count(*) filter (where days.steps >= coalesce(days.goal, 10000))::int
  from days
  group by days.week_start
  order by days.week_start desc
$$;

-- Everything that happened, newest first: sets added or removed, and changes.
create view public.activity_log
with (security_invoker = on) as
  select e.user_id, 'set'::text as kind, e.id::text as ref, e.group_id, g.name as group_name,
         null::text as old_value, e.delta::text as new_value, e.source,
         e.local_date, e.logged_at as happened_at
  from public.set_entries e
  join public.muscle_groups g on g.user_id = e.user_id and g.id = e.group_id
  union all
  select c.user_id, c.kind, c.id::text, c.group_id, g.name,
         c.old_value, c.new_value, null::text,
         c.local_date, c.changed_at
  from public.changes c
  left join public.muscle_groups g on g.user_id = c.user_id and g.id = c.group_id
  where c.local_date <> '-infinity';

revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- ===== Account deletion =====================================================

-- Deletes the signed-in account; every table cascades from auth.users.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.weekly_progress(int), public.weekly_steps(int) from public, anon;
grant execute on function public.weekly_progress(int), public.weekly_steps(int) to authenticated;
revoke execute on function public.local_today(uuid) from public, anon, authenticated;
