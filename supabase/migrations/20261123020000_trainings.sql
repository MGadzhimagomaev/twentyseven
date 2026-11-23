-- Trainings next to muscle groups. A tracked item is either a muscle group,
-- counted in sets toward the weekly goal, or a training (runs, rides, gym
-- sessions), counted in sessions toward its own weekly target.
-- Run after 20261123010000_setup_baseline.sql.

alter table public.muscle_groups
  add column kind text not null default 'sets' check (kind in ('sets', 'sessions'));

-- A training never follows the weekly goal of sets, so it always has a target.
alter table public.muscle_groups
  add constraint sessions_have_a_target check (kind = 'sets' or own_target is not null);
