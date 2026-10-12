// Worker: pulls due sources from the 'ingest' queue, fetches public job boards,
// normalizes postings with packages/core adapters, upserts them, embeds changed
// ones and queues affected users for rescoring. Invoked by pg_cron.
import { adapters, dedupeKey, type NormalizedPosting, type SourceKind } from "@vachi/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../_shared/clients.ts";
import { handler, json, log, requireWorker } from "../_shared/http.ts";
import { ack, MAX_DELIVERIES, readQueue, send } from "../_shared/queue.ts";
import { EMBEDDING_MODEL, embed, toVector } from "../_shared/ai/embeddings.ts";

const TIME_BUDGET_MS = 110_000;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "VachiJobHunt/1.0 (+https://vachiservices.com/bot)";

interface SourceRow {
  id: string; kind: SourceKind; token: string; company_id: string; etag: string | null;
  poll_interval: string; consecutive_failures: number; companies: { name: string } | null;
}

Deno.serve(handler(async (req) => {
  requireWorker(req);
  const db = serviceClient();
  const started = Date.now();
  const results: Array<{ source: string; status: string; upserted?: number }> = [];

  while (Date.now() - started < TIME_BUDGET_MS) {
    const msgs = await readQueue<{ source_id: string }>(db, "ingest", 300, 5);
    if (msgs.length === 0) break;
    for (const m of msgs) {
      if (m.read_ct > MAX_DELIVERIES) {
        log({ msg: "dropping poison ingest message", m });
        await ack(db, "ingest", m.msg_id);
        continue;
      }
      try {
        results.push(await ingestSource(db, m.message.source_id));
      } catch (e) {
        await recordFailure(db, m.message.source_id, String(e));
        results.push({ source: m.message.source_id, status: "failed" });
      }
      await ack(db, "ingest", m.msg_id);
    }
  }
  return json({ processed: results.length, results });
}));

async function ingestSource(db: SupabaseClient, sourceId: string) {
  const { data: src, error } = await db.schema("jobs").from("sources")
    .select("id, kind, token, company_id, etag, poll_interval, consecutive_failures, companies(name)")
    .eq("id", sourceId).single<SourceRow>();
  if (error) throw error;
  const adapter = adapters[src.kind];
  if (!adapter) throw new Error(`no adapter for ${src.kind}`);
  const companyName = src.companies?.name ?? src.token;

  const runStarted = new Date().toISOString();
  const res = await fetch(adapter.url({ kind: src.kind, token: src.token, companyName }), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(src.etag ? { "If-None-Match": src.etag } : {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 304) {
    await recordSuccess(db, src, null);
    return { source: sourceId, status: "not_modified" };
  }
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const postings = adapter.parse(await res.json(), { kind: src.kind, token: src.token, companyName });

  // Upsert postings.
  const rows = postings.map((p) => toRow(p, src));
  for (let i = 0; i < rows.length; i += 200) {
    const { error: upErr } = await db.schema("jobs").from("postings").upsert(rows.slice(i, i + 200), { onConflict: "source_id,external_id" });
    if (upErr) throw upErr;
  }
  // Postings no longer on the board are closed, never deleted (pipeline rows reference them).
  await db.schema("jobs").from("postings").update({ closed_at: runStarted })
    .eq("source_id", src.id).is("closed_at", null).lt("last_seen_at", runStarted);

  const changedFamilies = await embedChanged(db, src.id);
  if (changedFamilies.size) await queueRescore(db, [...changedFamilies]);
  await recordSuccess(db, src, res.headers.get("etag"));
  return { source: sourceId, status: "ok", upserted: rows.length };
}

function toRow(p: NormalizedPosting, src: SourceRow) {
  const now = new Date().toISOString();
  return {
    source_id: src.id,
    company_id: src.company_id,
    external_id: p.externalId,
    title: p.title,
    normalized_title: p.normalizedTitle,
    role_family: p.roleFamily,
    seniority: p.seniority ?? null,
    locations: p.locations,
    countries: [...new Set(p.locations.map((l) => l.country ?? "US"))],
    regions: [...new Set(p.locations.map((l) => l.region).filter((r): r is string => !!r))],
    remote_types: [...new Set(p.locations.map((l) => l.remote))],
    salary_min_usd: p.salary?.minUsd ?? null,
    salary_max_usd: p.salary?.maxUsd ?? null,
    description_text: p.descriptionText,
    apply_url: p.applyUrl,
    sponsorship_statement: p.sponsorshipStatement,
    posted_at: p.postedAt,
    last_seen_at: now,
    closed_at: null,
    content_hash: p.contentHash,
    dedupe_key: dedupeKey(p),
  };
}

/** Embeds postings whose content changed since their last embedding. Returns affected role families. */
async function embedChanged(db: SupabaseClient, sourceId: string): Promise<Set<string>> {
  const { data, error } = await db.schema("jobs").from("postings")
    .select("id, title, description_text, content_hash, embedded_hash, role_family")
    .eq("source_id", sourceId).is("closed_at", null);
  if (error) throw error;
  const stale = (data ?? []).filter((p) => p.embedded_hash !== p.content_hash);
  const families = new Set<string>();
  for (let i = 0; i < stale.length; i += 64) {
    const batch = stale.slice(i, i + 64);
    const vectors = await embed(batch.map((p) => `${p.title}\n\n${p.description_text.slice(0, 6000)}`), "document");
    await Promise.all(batch.map((p, j) =>
      db.schema("jobs").from("postings")
        .update({ embedding: toVector(vectors[j]!), embedding_model: EMBEDDING_MODEL, embedded_hash: p.content_hash })
        .eq("id", p.id)
    ));
    for (const p of batch) families.add(p.role_family);
  }
  return families;
}

/**
 * Stage 0: fan out to every user targeting a changed role family. At stage 1 this
 * becomes a per-family rescore job (ARCHITECTURE.md section 11).
 */
async function queueRescore(db: SupabaseClient, families: string[]) {
  const { data } = await db.from("preferences").select("user_id").overlaps("target_role_families", families).limit(5000);
  for (const u of data ?? []) await send(db, "score", { user_id: u.user_id });
}

function intervalMs(pg: string): number {
  const m = /^(\d+):(\d+):(\d+)/.exec(pg);
  return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 : 6 * 3_600_000;
}

async function recordSuccess(db: SupabaseClient, src: SourceRow, etag: string | null) {
  await db.schema("jobs").from("sources").update({
    last_success_at: new Date().toISOString(),
    next_poll_at: new Date(Date.now() + intervalMs(src.poll_interval)).toISOString(),
    consecutive_failures: 0,
    last_error: null,
    ...(etag ? { etag } : {}),
  }).eq("id", src.id);
}

async function recordFailure(db: SupabaseClient, sourceId: string, message: string) {
  const { data } = await db.schema("jobs").from("sources").select("consecutive_failures").eq("id", sourceId).maybeSingle();
  const n = (data?.consecutive_failures ?? 0) + 1;
  const backoff = Math.min(24 * 3_600_000, 30 * 60_000 * 2 ** (n - 1));
  await db.schema("jobs").from("sources").update({
    consecutive_failures: n,
    last_error: message.slice(0, 500),
    next_poll_at: new Date(Date.now() + backoff).toISOString(),
    // Disable sources that fail for a week straight; an admin re-enables them.
    ...(n >= 14 ? { enabled: false } : {}),
  }).eq("id", sourceId);
  log({ msg: "ingest failed", sourceId, failures: n, error: message });
}
