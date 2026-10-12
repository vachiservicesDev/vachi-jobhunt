-- matching module: per-user projection of global postings.
create table public.job_matches (
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id uuid not null references jobs.postings (id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  reasons text[] not null default '{}',
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  model_version text not null,
  scored_at timestamptz not null default now(),
  dismissed_at timestamptz,
  saved_at timestamptz,
  primary key (user_id, posting_id)
);
create index job_matches_feed_idx on public.job_matches (user_id, score desc) where dismissed_at is null;

alter table public.job_matches enable row level security;
create policy job_matches_read on public.job_matches for select using (user_id = (select auth.uid()));
-- Users may only save or dismiss; score columns are server-owned (enforced by column grants).
create policy job_matches_triage on public.job_matches for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.job_matches from authenticated;
grant update (dismissed_at, saved_at) on public.job_matches to authenticated;

-- Feed read model. Keyset pagination on (score, posting_id).
create or replace function public.get_feed(
  p_sponsor_only boolean default false,
  p_limit integer default 25,
  p_after_score smallint default null,
  p_after_posting uuid default null
)
returns table (
  posting_id uuid, score smallint, reasons text[], matched_skills text[], missing_skills text[],
  title text, company_name text, company_logo text, locations jsonb, salary_min_usd integer,
  salary_max_usd integer, posted_at timestamptz, apply_url text, sponsorship_statement text,
  sponsor_filings integer, saved boolean
)
language sql stable security invoker set search_path = '' as $$
  select m.posting_id, m.score, m.reasons, m.matched_skills, m.missing_skills,
         p.title, c.name, c.logo_url, p.locations, p.salary_min_usd, p.salary_max_usd,
         p.posted_at, p.apply_url, p.sponsorship_statement,
         s.certified_count, m.saved_at is not null
  from public.job_matches m
  join jobs.postings p on p.id = m.posting_id and p.closed_at is null
  join jobs.companies c on c.id = p.company_id
  left join lateral (
    select es.certified_count from sponsor.employer_stats es
    where es.company_id = c.id order by es.fiscal_year desc limit 1
  ) s on true
  where m.user_id = (select auth.uid())
    and m.dismissed_at is null
    and (not p_sponsor_only or (p.sponsorship_statement <> 'denies' and (p.sponsorship_statement = 'offers' or coalesce(s.certified_count, 0) > 0)))
    and (p_after_score is null or (m.score, m.posting_id) < (p_after_score, p_after_posting))
  order by m.score desc, m.posting_id desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Vector recall used by the score-matches worker (service role).
create or replace function public.recall_postings(
  p_embedding extensions.vector(1024),
  p_families text[],
  p_countries text[],
  p_limit integer default 300
)
returns table (posting_id uuid, similarity real)
language sql stable set search_path = '' as $$
  select p.id, (1 - (p.embedding operator(extensions.<=>) p_embedding))::real
  from jobs.postings p
  where p.closed_at is null
    and p.embedding is not null
    and (cardinality(p_families) = 0 or p.role_family = any (p_families))
    and (cardinality(p_countries) = 0 or p.countries && p_countries)
  order by p.embedding operator(extensions.<=>) p_embedding
  limit p_limit;
$$;
revoke execute on function public.recall_postings from public, anon, authenticated;
