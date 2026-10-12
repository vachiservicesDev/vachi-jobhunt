-- Background work: pgmq queues fed by pg_cron (ARCHITECTURE.md D5).
-- Enable "pgmq" and "pg_cron" in the Supabase dashboard (Integrations) before applying.
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

select pgmq.create('ingest');
select pgmq.create('embed');
select pgmq.create('score');
select pgmq.create('parse');

-- Enqueue sources that are due. Ingestion workers update next_poll_at on completion.
create or replace function jobs.enqueue_due_sources(p_max integer default 200) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with due as (
    select id from jobs.sources
    where enabled and next_poll_at <= now()
    order by next_poll_at
    limit p_max
    for update skip locked
  ), bumped as (
    update jobs.sources s set next_poll_at = now() + interval '30 minutes' -- lease; worker sets the real next time
    from due where s.id = due.id
    returning s.id
  )
  select count(*) into n from (
    select pgmq.send('ingest', jsonb_build_object('source_id', id)) from bumped
  ) q;
  return n;
end $$;

-- Calls a worker Edge Function. URL and service key come from Vault secrets
-- named 'project_url' and 'worker_secret' (set once per environment).
create or replace function public.invoke_worker(p_name text) returns void
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret')),
    body := '{}'::jsonb
  );
$$;
revoke execute on function public.invoke_worker from public, anon, authenticated;

select cron.schedule('enqueue-sources', '*/15 * * * *', $$select jobs.enqueue_due_sources()$$);
select cron.schedule('run-ingest', '*/5 * * * *', $$select public.invoke_worker('ingest-jobs')$$);
select cron.schedule('run-score', '*/5 * * * *', $$select public.invoke_worker('score-matches')$$);

-- Thin queue wrappers for workers (service role only), so workers don't need the
-- pgmq schema exposed through the API.
create or replace function public.queue_send(p_queue text, p_msg jsonb, p_delay integer default 0) returns bigint
language sql security definer set search_path = '' as $$ select pgmq.send(p_queue, p_msg, p_delay) $$;
create or replace function public.queue_read(p_queue text, p_vt integer, p_qty integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql security definer set search_path = '' as $$
  select r.msg_id, r.read_ct, r.message from pgmq.read(p_queue, p_vt, p_qty) r
$$;
create or replace function public.queue_delete(p_queue text, p_msg_id bigint) returns boolean
language sql security definer set search_path = '' as $$ select pgmq.delete(p_queue, p_msg_id) $$;
revoke execute on function public.queue_send, public.queue_read, public.queue_delete from public, anon, authenticated;
grant execute on function public.queue_send, public.queue_read, public.queue_delete to service_role;
