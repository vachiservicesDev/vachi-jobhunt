import type { SupabaseClient } from "@supabase/supabase-js";
import { Preferences, roleFamily, scoreMatch, type MatchPosting, type ParsedLocation } from "@vachi/core";
import { log } from "./http.ts";

const RECALL_LIMIT = 400;
const KEEP_TOP = 200;

interface PreferencesRow {
  target_roles: string[];
  locations: Array<{ city?: string; region?: string; country?: string }>;
  remote: Preferences["remote"];
  salary_min_usd: number | null;
  needs_sponsorship: boolean;
  seniority: Preferences["seniority"] | null;
}

export function preferencesFromRow(r: PreferencesRow): Preferences {
  return Preferences.parse({
    targetRoles: r.target_roles,
    locations: r.locations,
    remote: r.remote,
    salaryMinUsd: r.salary_min_usd,
    needsSponsorship: r.needs_sponsorship,
    seniority: r.seniority ?? undefined,
  });
}

/**
 * Recomputes one user's feed: vector recall → deterministic score (packages/core) →
 * upsert top matches → drop stale unsaved ones. Idempotent; safe to run repeatedly.
 */
export async function scoreUser(db: SupabaseClient, userId: string): Promise<{ scored: number; kept: number }> {
  const runStarted = new Date().toISOString();
  const { data: prefRow } = await db.from("preferences").select("*").eq("user_id", userId).maybeSingle();
  if (!prefRow || !prefRow.target_roles?.length) return { scored: 0, kept: 0 };
  const prefs = preferencesFromRow(prefRow as PreferencesRow);

  const { data: resume } = await db.from("current_resume").select("skills, experience_months, embedding").eq("user_id", userId).maybeSingle();
  const families = [...new Set(prefs.targetRoles.map(roleFamily))].filter((f) => f !== "other");
  const countries = [...new Set(prefs.locations.map((l) => l.country))];
  if (countries.length === 0) countries.push("US");

  // 1. Recall
  let candidates: Array<{ id: string; similarity?: number }>;
  if (resume?.embedding) {
    const { data, error } = await db.rpc("recall_postings", { p_embedding: resume.embedding, p_families: families, p_countries: countries, p_limit: RECALL_LIMIT });
    if (error) throw error;
    candidates = (data as Array<{ posting_id: string; similarity: number }>).map((r) => ({ id: r.posting_id, similarity: r.similarity }));
  } else {
    let q = db.schema("jobs").from("postings").select("id").is("closed_at", null).overlaps("countries", countries).order("posted_at", { ascending: false }).limit(RECALL_LIMIT);
    if (families.length) q = q.in("role_family", families);
    const { data, error } = await q;
    if (error) throw error;
    candidates = (data ?? []).map((r: { id: string }) => ({ id: r.id }));
  }
  if (candidates.length === 0) return { scored: 0, kept: 0 };

  // 2. Details and sponsor history
  const postings = new Map<string, MatchPosting & { company_id: string }>();
  for (let i = 0; i < candidates.length; i += 100) {
    const ids = candidates.slice(i, i + 100).map((c) => c.id);
    const { data, error } = await db.schema("jobs").from("postings")
      .select("id, company_id, title, role_family, seniority, locations, salary_min_usd, salary_max_usd, sponsorship_statement, description_text, posted_at")
      .in("id", ids);
    if (error) throw error;
    for (const p of data ?? []) {
      postings.set(p.id, {
        company_id: p.company_id,
        title: p.title,
        roleFamily: p.role_family,
        seniority: p.seniority ?? undefined,
        locations: p.locations as ParsedLocation[],
        salary: p.salary_min_usd && p.salary_max_usd ? { minUsd: p.salary_min_usd, maxUsd: p.salary_max_usd } : null,
        sponsorshipStatement: p.sponsorship_statement,
        descriptionText: p.description_text,
        postedAt: p.posted_at,
      });
    }
  }
  const filings = new Map<string, number>();
  if (prefs.needsSponsorship) {
    const companyIds = [...new Set([...postings.values()].map((p) => p.company_id))];
    const { data } = await db.schema("sponsor").from("employer_stats").select("company_id, fiscal_year, certified_count").in("company_id", companyIds).order("fiscal_year", { ascending: false });
    for (const s of data ?? []) if (!filings.has(s.company_id)) filings.set(s.company_id, s.certified_count);
  }

  // 3. Score
  const { data: feedCfg } = await db.from("app_config").select("value").eq("key", "feed").maybeSingle();
  const minScore = (feedCfg?.value as { min_score?: number } | undefined)?.min_score ?? 35;
  const rows = [];
  for (const c of candidates) {
    const p = postings.get(c.id);
    if (!p) continue;
    const r = scoreMatch({
      preferences: prefs,
      resumeSkills: resume?.skills ?? [],
      experienceMonths: resume?.experience_months ?? 0,
      posting: p,
      semanticSimilarity: c.similarity,
      sponsorFilings: filings.get(p.company_id),
    });
    if (r.excluded || r.score < minScore) continue;
    rows.push({
      user_id: userId, posting_id: c.id, score: r.score, reasons: r.reasons,
      matched_skills: r.matchedSkills, missing_skills: r.missingSkills, model_version: r.modelVersion, scored_at: new Date().toISOString(),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const keep = rows.slice(0, KEEP_TOP);

  // 4. Write (upsert keeps the user's saved/dismissed flags) and prune stale unsaved matches.
  if (keep.length) {
    const { error } = await db.from("job_matches").upsert(keep, { onConflict: "user_id,posting_id" });
    if (error) throw error;
  }
  await db.from("job_matches").delete().eq("user_id", userId).lt("scored_at", runStarted).is("saved_at", null);
  log({ msg: "scored", userId, candidates: candidates.length, kept: keep.length });
  return { scored: candidates.length, kept: keep.length };
}
