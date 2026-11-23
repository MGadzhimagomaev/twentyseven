-- Feedback sent from inside the app. Every message is saved here; it is also
-- emailed to the developer once a Resend API key and an address are stored in
-- Supabase Vault. Run after 20261123030000_training_targets.sql.
--
-- To turn on the emails, run these two lines in the SQL editor with your own
-- values (Resend's free plan can email the address you signed up with, no domain
-- needed). The key stays in Vault; it never goes into the app or the repository.
--   select vault.create_secret('re_your_key', 'resend_api_key');
--   select vault.create_secret('you@example.com', 'feedback_email');

create table public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message     text not null check (char_length(message) between 1 and 4000),
  app_version text check (char_length(app_version) <= 40),
  page        text check (char_length(page) <= 40),
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;
create policy "send feedback" on public.feedback for insert to authenticated with check (user_id = (select auth.uid()));
create policy "read own feedback" on public.feedback for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.feedback from anon, authenticated;
grant select, insert on public.feedback to authenticated;

-- pg_net sends the email from inside the database, after the row is saved.
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end;
$$;

create or replace function public.email_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  send_to text;
  sender  text;
begin
  select s.decrypted_secret into api_key from vault.decrypted_secrets s where s.name = 'resend_api_key';
  select s.decrypted_secret into send_to from vault.decrypted_secrets s where s.name = 'feedback_email';
  if api_key is null or send_to is null then
    return new;                                   -- emails not set up: the message is still saved
  end if;
  select u.email into sender from auth.users u where u.id = new.user_id;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_strip_nulls(jsonb_build_object(
      'from', '20/7 feedback <onboarding@resend.dev>',
      'to', jsonb_build_array(send_to),
      'reply_to', sender,
      'subject', '20/7 feedback from ' || coalesce(sender, 'someone'),
      'text', new.message || E'\n\n— ' || coalesce(sender, 'unknown sender')
              || coalesce(' · app ' || new.app_version, '') || coalesce(' · ' || new.page, ''))));
  return new;
exception when others then
  return new;                                     -- trouble with the email never loses the message
end;
$$;

revoke execute on function public.email_feedback() from public, anon, authenticated;

create trigger feedback_email
  after insert on public.feedback
  for each row execute function public.email_feedback();
