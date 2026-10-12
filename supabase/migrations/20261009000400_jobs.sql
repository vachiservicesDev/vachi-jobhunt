-- jobs module: global postings shared by all users. Written only by ingestion workers.
create table jobs.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,      -- normalizeEmployerName() in packages/core
  website text,
  logo_url text,
  created_at timestamptz not null default now()
);
create index companies_name_trgm on jobs.companies using gin (normalized_name extensions.gin_trgm_ops);

create table jobs.sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('greenhouse', 'lever', 'ashby', 'usajobs')),
  token text not null,
  company_id uuid not null references jobs.companies (id),
  enabled boolean not null default true,
  poll_interval interval not null default interval '6 hours',
  next_poll_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  etag text,
  unique (kind, token)
);
create index sources_due_idx on jobs.sources (next_poll_at) where enabled;

create table jobs.postings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references jobs.sources (id),
  company_id uuid not null references jobs.companies (id),
  external_id text not null,
  title text not null,
  normalized_title text not null,
  role_family text not null,
  seniority text,
  locations jsonb not null default '[]',
  countries text[] not null default '{}',    -- denormalized for filtering
  regions text[] not null default '{}',
  remote_types text[] not null default '{}',
  salary_min_usd integer,
  salary_max_usd integer,
  description_text text not null,
  apply_url text not null,
  sponsorship_statement text not null default 'unknown' check (sponsorship_statement in ('offers', 'denies', 'unknown')),
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  content_hash text not null,
  dedupe_key text not null,
  canonical_id uuid references jobs.postings (id),
  embedding extensions.vector(1024),
  embedding_model text,
  embedded_hash text,                        -- content_hash the embedding was computed from
  unique (source_id, external_id)
);
create index postings_open_family_idx on jobs.postings (role_family, posted_at desc) where closed_at is null;
create index postings_company_idx on jobs.postings (company_id) where closed_at is null;
create index postings_countries_idx on jobs.postings using gin (countries) where closed_at is null;
create index postings_dedupe_idx on jobs.postings (dedupe_key);
create index postings_embedding_hnsw on jobs.postings using hnsw (embedding extensions.vector_cosine_ops) where closed_at is null;

alter table jobs.companies enable row level security;
alter table jobs.sources enable row level security;
alter table jobs.postings enable row level security;

-- Signed-in users can read open postings and companies; the app reaches them through public views.
create policy companies_read on jobs.companies for select to authenticated using (true);
create policy postings_read on jobs.postings for select to authenticated using (closed_at is null);

grant usage on schema jobs to authenticated;
grant select on jobs.companies, jobs.postings to authenticated;
