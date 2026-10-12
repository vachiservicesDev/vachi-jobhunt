-- pipeline module (weeks 3 to 6). Created now so later work is additive.
-- Invariant: the server never submits. 'submitted' requires an approval row (trigger below).
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id uuid not null references jobs.postings (id),
  resume_version_id uuid references public.resume_versions (id),
  status text not null default 'saved' check (status in ('saved', 'preparing', 'ready', 'submitted', 'interviewing', 'offer', 'rejected', 'withdrawn')),
  packet jsonb,
  packet_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, posting_id)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  packet_hash text not null,
  approved_at timestamptz not null default now(),
  client_info jsonb not null default '{}'
);

create table public.application_events (
  id bigint generated always as identity,
  at timestamptz not null default now(),
  application_id uuid not null,
  user_id uuid not null,
  from_status text,
  to_status text not null,
  note text,
  primary key (id, at)
) partition by range (at);
create table public.application_events_default partition of public.application_events default;

create trigger applications_updated before update on public.applications for each row execute function public.set_updated_at();

create or replace function public.guard_application_submit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if (select auth.uid()) is distinct from new.user_id then
      raise exception 'Only the applicant can mark an application submitted';
    end if;
    if not exists (
      select 1 from public.approvals a
      where a.application_id = new.id and a.user_id = new.user_id and a.packet_hash = new.packet_hash
    ) then
      raise exception 'Submitting requires the user''s approval of this exact packet';
    end if;
  end if;
  insert into public.application_events (application_id, user_id, from_status, to_status)
  values (new.id, new.user_id, old.status, new.status);
  return new;
end $$;
create trigger applications_guard before update of status on public.applications
  for each row execute function public.guard_application_submit();

alter table public.applications enable row level security;
alter table public.approvals enable row level security;
alter table public.application_events enable row level security;
create policy applications_own on public.applications for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy approvals_own_insert on public.approvals for insert with check (user_id = (select auth.uid()));
create policy approvals_own_read on public.approvals for select using (user_id = (select auth.uid()));
create policy application_events_read on public.application_events for select using (user_id = (select auth.uid()));
