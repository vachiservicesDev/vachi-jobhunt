-- billing module: entitlements mirrored from RevenueCat, and server-side usage counters.
create table billing.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  active_until timestamptz,
  rc_app_user_id text,
  last_event_id text,
  updated_at timestamptz not null default now()
);

create table billing.webhook_events (
  event_id text primary key,                 -- idempotency
  received_at timestamptz not null default now(),
  payload jsonb not null
);

create table billing.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('tailor', 'practice', 'parse', 'explain')),
  period_start date not null,
  used integer not null default 0,
  primary key (user_id, feature, period_start)
);

alter table billing.entitlements enable row level security;
alter table billing.webhook_events enable row level security;
alter table billing.usage_counters enable row level security;
create policy entitlements_read on billing.entitlements for select to authenticated using (user_id = (select auth.uid()));
create policy usage_read on billing.usage_counters for select to authenticated using (user_id = (select auth.uid()));
grant usage on schema billing to authenticated;
grant select on billing.entitlements, billing.usage_counters to authenticated;

-- Atomically consumes one unit of a metered feature for the current month.
-- Returns false when the plan's quota is used up. Called only by server functions.
create or replace function billing.consume_quota(p_user uuid, p_feature text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_plan text;
  v_limit integer;
  v_used integer;
  v_period date := date_trunc('month', now())::date;
begin
  select case when e.plan = 'pro' and (e.active_until is null or e.active_until > now()) then 'pro' else 'free' end
    into v_plan from billing.entitlements e where e.user_id = p_user;
  v_plan := coalesce(v_plan, 'free');
  select (c.value -> v_plan ->> p_feature)::integer into v_limit from public.app_config c where c.key = 'quotas';
  if v_limit is null then
    return true; -- feature not metered
  end if;

  insert into billing.usage_counters (user_id, feature, period_start, used)
  values (p_user, p_feature, v_period, 1)
  on conflict (user_id, feature, period_start)
  do update set used = billing.usage_counters.used + 1
    where billing.usage_counters.used < v_limit
  returning used into v_used;

  return v_used is not null;
end $$;
revoke execute on function billing.consume_quota from public, anon, authenticated;

-- ai module: usage and cost log. No prompt or completion content is stored.
create table ai.usage_log (
  id bigint generated always as identity,
  at timestamptz not null default now(),
  user_id uuid,
  task text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  latency_ms integer not null,
  ok boolean not null,
  error_code text,
  primary key (id, at)
) partition by range (at);

create table ai.usage_log_default partition of ai.usage_log default;
create index usage_log_user_idx on ai.usage_log (user_id, at desc);
alter table ai.usage_log enable row level security;
