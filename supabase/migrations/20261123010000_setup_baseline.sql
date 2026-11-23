-- Choices made during first-launch setup (weekly goal, week start) become the
-- starting values instead of showing up in the activity log as changes on day
-- one. Run after 20261123000000_init.sql.

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
