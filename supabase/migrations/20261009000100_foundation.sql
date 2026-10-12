-- Extensions and module schemas (ARCHITECTURE.md section 4).
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists jobs;
create schema if not exists sponsor;
create schema if not exists billing;
create schema if not exists ai;
create schema if not exists audit;

-- Shared updated_at trigger.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Remote config and forced-upgrade gate, readable by everyone, writable by service role only.
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select using (true);

insert into public.app_config (key, value) values
  ('min_supported_version', '"1.0.0"'),
  ('quotas', '{"free": {"tailor": 3, "practice": 2, "parse": 10}, "pro": {"tailor": 200, "practice": 60, "parse": 50}}'),
  ('feed', '{"page_size": 25, "min_score": 35}');

-- Admin and system audit trail (append-only).
create table audit.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  subject text,
  detail jsonb not null default '{}'
);
alter table audit.events enable row level security;
