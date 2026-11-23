-- A training's target in weeks before it was added (when sessions are logged into
-- earlier weeks) is its first own target, not the weekly goal of sets.
-- Run after 20261123020000_trainings.sql. Same columns as before, so the apps
-- need no change.

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
           g.archived_at is not null as archived, coalesce(sm.sets, 0) as sets, g.kind, g.own_target
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
      -- A training never follows the weekly goal of sets: before its first target
      -- was set (sets logged into earlier weeks), it uses that first target.
      case when c.kind = 'sessions' then coalesce(
        (select nullif(ch.new_value, '')::int
           from public.changes ch
          where ch.user_id = c.user_id and ch.kind = 'group_target' and ch.group_id = c.group_id
          order by ch.local_date, ch.id
          limit 1),
        c.own_target)
      end,
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
