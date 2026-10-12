-- sponsor module: public DOL LCA disclosure data (ARCHITECTURE.md section 8).
create table sponsor.lca_cases (
  case_number text primary key,
  fiscal_year smallint not null,
  visa_class text not null,
  employer_name_raw text not null,
  employer_name_normalized text not null,
  soc_code text,
  job_title text,
  worksite_city text,
  worksite_state text,
  wage_from numeric,
  wage_unit text,
  decision_date date,
  case_status text not null
);
create index lca_employer_idx on sponsor.lca_cases (employer_name_normalized, fiscal_year);

create table sponsor.employer_aliases (
  normalized_name text primary key,
  company_id uuid not null references jobs.companies (id),
  method text not null check (method in ('exact', 'trigram', 'manual')),
  confidence real not null default 1
);

create table sponsor.employer_stats (
  company_id uuid not null references jobs.companies (id),
  fiscal_year smallint not null,
  certified_count integer not null,
  top_soc_codes text[] not null default '{}',
  median_annual_wage numeric,
  last_filed_at date,
  primary key (company_id, fiscal_year)
);

alter table sponsor.lca_cases enable row level security;
alter table sponsor.employer_aliases enable row level security;
alter table sponsor.employer_stats enable row level security;
create policy employer_stats_read on sponsor.employer_stats for select to authenticated using (true);
grant usage on schema sponsor to authenticated;
grant select on sponsor.employer_stats to authenticated;
