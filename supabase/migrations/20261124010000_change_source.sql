-- Where each change came from, as sets already record: web, ios or import.
-- Changes are written by triggers, which can't see the device, so every app
-- sends `source` with each save of settings or groups, and the triggers copy
-- it onto the changes they log. Everything so far came from the web app.
-- Run after 20261124000000_feedback.sql.

alter table public.changes
  add column source text not null default 'web' check (source in ('web', 'ios', 'import'));

-- Where the row was last saved from.
alter table public.settings
  add column source text not null default 'web' check (source in ('web', 'ios', 'import'));
alter table public.muscle_groups
  add column source text not null default 'web' check (source in ('web', 'ios', 'import'));

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
    insert into public.changes (user_id, kind, new_value, local_date, source)
    values (new.user_id, 'weekly_goal', new.weekly_goal::text, '-infinity', new.source),
           (new.user_id, 'step_goal', new.step_goal::text, '-infinity', new.source);
    return new;
  end if;

  -- Until setup is finished, including the update that finishes it, a new goal
  -- replaces the starting value rather than counting as a change.
  if old.onboarded_at is null then
    if new.weekly_goal is distinct from old.weekly_goal then
      update public.changes set new_value = new.weekly_goal::text
       where user_id = new.user_id and kind = 'weekly_goal' and local_date = '-infinity';
    end if;
    if new.step_goal is distinct from old.step_goal then
      update public.changes set new_value = new.step_goal::text
       where user_id = new.user_id and kind = 'step_goal' and local_date = '-infinity';
    end if;
    new.updated_at := now();
    return new;
  end if;

  today := public.local_today(new.user_id);
  if new.weekly_goal is distinct from old.weekly_goal then
    insert into public.changes (user_id, kind, old_value, new_value, local_date, source)
    values (new.user_id, 'weekly_goal', old.weekly_goal::text, new.weekly_goal::text, today, new.source);
  end if;
  if new.step_goal is distinct from old.step_goal then
    insert into public.changes (user_id, kind, old_value, new_value, local_date, source)
    values (new.user_id, 'step_goal', old.step_goal::text, new.step_goal::text, today, new.source);
  end if;
  if new.week_start is distinct from old.week_start then
    insert into public.changes (user_id, kind, old_value, new_value, local_date, source)
    values (new.user_id, 'week_start', old.week_start, new.week_start, today, new.source);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

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
      insert into public.changes (user_id, kind, group_id, new_value, local_date, source)
      values (new.user_id, 'group_added', new.id, new.name, today, new.source);
    end if;
    if new.own_target is not null then
      insert into public.changes (user_id, kind, group_id, new_value, local_date, source)
      values (new.user_id, 'group_target', new.id, new.own_target::text, today, new.source);
    end if;
    return new;
  end if;

  if new.name is distinct from old.name then
    insert into public.changes (user_id, kind, group_id, old_value, new_value, local_date, source)
    values (new.user_id, 'group_renamed', new.id, old.name, new.name, today, new.source);
  end if;
  if new.own_target is distinct from old.own_target then
    insert into public.changes (user_id, kind, group_id, old_value, new_value, local_date, source)
    values (new.user_id, 'group_target', new.id, old.own_target::text, new.own_target::text, today, new.source);
  end if;
  if new.archived_at is distinct from old.archived_at then
    insert into public.changes (user_id, kind, group_id, new_value, local_date, source)
    values (new.user_id,
            case when new.archived_at is null then 'group_restored' else 'group_removed' end,
            new.id, new.name, today, new.source);
  end if;
  return new;
end;
$$;

-- The activity log now shows the source of changes too, not only of sets.
create or replace view public.activity_log
with (security_invoker = on) as
  select e.user_id, 'set'::text as kind, e.id::text as ref, e.group_id, g.name as group_name,
         null::text as old_value, e.delta::text as new_value, e.source,
         e.local_date, e.logged_at as happened_at
  from public.set_entries e
  join public.muscle_groups g on g.user_id = e.user_id and g.id = e.group_id
  union all
  select c.user_id, c.kind, c.id::text, c.group_id, g.name,
         c.old_value, c.new_value, c.source,
         c.local_date, c.changed_at
  from public.changes c
  left join public.muscle_groups g on g.user_id = c.user_id and g.id = c.group_id
  where c.local_date <> '-infinity';
