-- resume module: uploaded files and structured versions (ResumeDocument in packages/core).
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default 'My resume',
  storage_path text not null,               -- resumes/{user_id}/{id}.{ext}
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  parse_status text not null default 'pending' check (parse_status in ('pending', 'parsing', 'parsed', 'failed')),
  parse_error text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resumes_user_idx on public.resumes (user_id, created_at desc);
create unique index resumes_one_primary on public.resumes (user_id) where is_primary;

create table public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null references public.resumes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('upload', 'edit', 'tailored')),
  posting_id uuid,                           -- set when source = 'tailored'
  schema_version smallint not null,
  document jsonb not null,
  skills text[] not null default '{}',       -- denormalized for matching
  experience_months integer not null default 0,
  embedding extensions.vector(1024),
  embedding_model text,
  prompt_version text,
  created_at timestamptz not null default now()
);
create index resume_versions_resume_idx on public.resume_versions (resume_id, created_at desc);

create trigger resumes_updated before update on public.resumes for each row execute function public.set_updated_at();

alter table public.resumes enable row level security;
alter table public.resume_versions enable row level security;

create policy resumes_own on public.resumes for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Users read their versions; only server functions write them.
create policy resume_versions_read on public.resume_versions for select
  using (user_id = (select auth.uid()));

-- The latest parsed version of the user's primary resume, used by matching.
create or replace view public.current_resume with (security_invoker = true) as
select distinct on (r.user_id)
  r.user_id, r.id as resume_id, v.id as version_id, v.document, v.skills, v.experience_months, v.embedding
from public.resumes r
join public.resume_versions v on v.resume_id = r.id and v.source in ('upload', 'edit')
where r.is_primary
order by r.user_id, v.created_at desc;
