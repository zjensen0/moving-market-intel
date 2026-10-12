-- Moving Market Intelligence: log of "Ask Acumena" questions, used for the daily limit and the admin log.
-- Rows are written by the /api/ask server function using the asking user's own login, so the access
-- rules below apply to it like any other request. Nobody can edit or delete a row (that keeps the
-- daily limit honest); admins can read all of them, everyone else only their own.

create table public.ai_questions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete set null,
  question text not null check (length(question) between 1 and 1000),
  answer text,
  model text,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);
create index ai_questions_user_day on public.ai_questions (user_id, created_at);

alter table public.ai_questions enable row level security;

create policy ai_insert_own on public.ai_questions for insert to authenticated
  with check (user_id = auth.uid() and (org_id is null or org_id = public.my_org_id() or public.is_admin()));
create policy ai_select on public.ai_questions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- How many questions the signed-in user has asked since midnight UTC.
create or replace function public.ai_questions_today() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_questions
  where user_id = auth.uid() and created_at >= date_trunc('day', now());
$$;
revoke all on function public.ai_questions_today() from public, anon;
grant execute on function public.ai_questions_today() to authenticated;
