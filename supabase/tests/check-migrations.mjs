// Applies all migrations to an in-process Postgres (PGlite) with minimal Supabase
// stubs, then checks RLS isolation and the server-side invariants. Runs in CI
// without Docker: `npm run test:db`. The queues migration needs pgmq/pg_cron,
// which PGlite lacks, so it is only syntax-checked by the Supabase CLI.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = join(import.meta.dirname, "..", "migrations");
const SKIP = new Set(["20261009001000_queues.sql"]);

const db = new PGlite({ extensions: { vector, pg_trgm, pgcrypto } });

// Minimal Supabase platform stubs.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create schema auth; create schema storage;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  if (SKIP.has(f)) { console.log(`skip  ${f}`); continue; }
  try {
    await db.exec(readFileSync(join(dir, f), "utf8"));
    console.log(`ok    ${f}`);
  } catch (e) {
    console.error(`FAIL  ${f}: ${e.message}`);
    process.exit(1);
  }
}

await db.exec(readFileSync(join(dir, "..", "seed.sql"), "utf8"));
console.log("ok    seed.sql");

// --- Fixtures (as superuser) ---
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
await db.exec(`
  insert into auth.users (id) values ('${A}'), ('${B}');
  insert into jobs.companies (id, name, normalized_name) values ('10000000-0000-0000-0000-000000000001', 'Acme', 'acme');
  insert into jobs.sources (id, kind, token, company_id) values ('20000000-0000-0000-0000-000000000001', 'greenhouse', 'acme', '10000000-0000-0000-0000-000000000001');
  insert into jobs.postings (id, source_id, company_id, external_id, title, normalized_title, role_family, description_text, apply_url, content_hash, dedupe_key, sponsorship_statement)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '1', 'Engineer', 'engineer', 'software_engineering', 'x', 'https://example.com', 'h', 'd', 'unknown'),
         ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2', 'Engineer 2', 'engineer 2', 'software_engineering', 'x', 'https://example.com', 'h', 'd', 'denies');
  insert into sponsor.employer_stats (company_id, fiscal_year, certified_count) values ('10000000-0000-0000-0000-000000000001', 2026, 120);
  insert into public.job_matches (user_id, posting_id, score, model_version) values
    ('${A}', '30000000-0000-0000-0000-000000000001', 80, 'rules-1'),
    ('${A}', '30000000-0000-0000-0000-000000000002', 70, 'rules-1'),
    ('${B}', '30000000-0000-0000-0000-000000000001', 60, 'rules-1');
`);

async function as(user, sql, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

// Profile created by trigger, and users see only their own.
assert.equal((await as(A, `select * from public.profiles`)).rows.length, 1, "A sees own profile only");
await as(A, `insert into public.preferences (user_id, target_roles, needs_sponsorship) values ($1, '{Engineer}', true)`, [A]);
await assert.rejects(as(A, `insert into public.preferences (user_id, target_roles) values ($1, '{x}')`, [B]), "A cannot write B's preferences");
assert.equal((await as(B, `select * from public.preferences`)).rows.length, 0, "B cannot read A's preferences");

// Feed is per-user and the sponsor filter excludes postings that deny sponsorship.
const feedA = await as(A, `select posting_id, score, sponsor_filings from public.get_feed()`);
assert.equal(feedA.rows.length, 2);
const sponsorA = await as(A, `select posting_id from public.get_feed(p_sponsor_only => true)`);
assert.deepEqual(sponsorA.rows.map((r) => r.posting_id), ["30000000-0000-0000-0000-000000000001"]);
assert.equal((await as(B, `select * from public.get_feed()`)).rows.length, 1);

// Users can dismiss but not rewrite scores.
await as(A, `update public.job_matches set dismissed_at = now() where posting_id = '30000000-0000-0000-0000-000000000002'`);
await assert.rejects(as(A, `update public.job_matches set score = 100`), "score is server-owned");

// Server-only functions are not callable by users.
await assert.rejects(as(A, `select billing.consume_quota($1, 'tailor')`, [A]));

// Quota: free plan allows 3 tailors a month.
const q = [];
for (let i = 0; i < 4; i++) q.push((await db.query(`select billing.consume_quota($1, 'tailor') as ok`, [A])).rows[0].ok);
assert.deepEqual(q, [true, true, true, false]);

// Apply invariant: cannot mark submitted without an approval of the exact packet, and never as server.
await as(A, `insert into public.applications (id, user_id, posting_id, status, packet_hash) values ('40000000-0000-0000-0000-000000000001', $1, '30000000-0000-0000-0000-000000000001', 'ready', 'p1')`, [A]);
await assert.rejects(as(A, `update public.applications set status = 'submitted'`), /approval/);
await as(A, `insert into public.approvals (application_id, user_id, packet_hash) values ('40000000-0000-0000-0000-000000000001', $1, 'p1')`, [A]);
await as(A, `update public.applications set status = 'submitted'`);
await db.exec(`update public.applications set status = 'ready'`);
await assert.rejects(db.exec(`update public.applications set status = 'submitted'`), /Only the applicant/);
assert.deepEqual((await as(A, `select to_status from public.application_events order by id`)).rows.map((r) => r.to_status), ["submitted", "ready"]);

// Every table in user-facing schemas has RLS enabled.
const noRls = await db.query(`
  select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname in ('public', 'jobs', 'sponsor', 'billing', 'ai', 'audit') and not c.relrowsecurity`);
assert.deepEqual(noRls.rows, [], `tables without RLS: ${JSON.stringify(noRls.rows)}`);

console.log("all database checks passed");
