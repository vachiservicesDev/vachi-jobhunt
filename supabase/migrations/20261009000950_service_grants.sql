-- Server functions use the service role. It bypasses RLS but still needs privileges
-- on the module schemas (Supabase grants these automatically only for public).
grant usage on schema jobs, sponsor, billing, ai, audit to service_role;
grant all on all tables in schema jobs, sponsor, billing, ai, audit to service_role;
grant all on all sequences in schema jobs, sponsor, billing, ai, audit to service_role;
alter default privileges in schema jobs, sponsor, billing, ai, audit grant all on tables to service_role;
alter default privileges in schema jobs, sponsor, billing, ai, audit grant all on sequences to service_role;
grant execute on function billing.consume_quota(uuid, text) to service_role;
grant execute on function public.recall_postings(extensions.vector, text[], text[], integer) to service_role;
