-- identity module: profiles and job-search preferences.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  onboarded_at timestamptz,
  consent_ai_processing_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_roles text[] not null default '{}' check (cardinality(target_roles) <= 5),
  target_role_families text[] not null default '{}',
  locations jsonb not null default '[]',
  remote text not null default 'any' check (remote in ('onsite', 'hybrid', 'remote', 'any')),
  salary_min_usd integer check (salary_min_usd is null or salary_min_usd between 0 and 2000000),
  -- Sensitive: never exported to analytics or third parties (ARCHITECTURE.md section 10).
  needs_sponsorship boolean not null default false,
  seniority text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger preferences_updated before update on public.preferences for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.preferences enable row level security;

create policy profiles_own on public.profiles for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy preferences_own on public.preferences for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Create the profile row on sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
