import type { Preferences } from "../schemas/preferences.ts";
import type { NormalizedPosting } from "../schemas/posting.ts";
import { canonicalize, skillsMentioned } from "./skills.ts";
import { roleFamily } from "../ingest/title.ts";

/**
 * Deterministic, explainable match score (ARCHITECTURE.md D4). Vector similarity
 * is an input, computed by pgvector during recall; everything else is rules.
 * Bump MATCH_MODEL_VERSION whenever weights or rules change so stored scores
 * can be recomputed.
 */
export const MATCH_MODEL_VERSION = "rules-1";

export const WEIGHTS = {
  semantic: 30,
  role: 20,
  skills: 30,
  seniority: 10,
  salary: 5,
  freshness: 5,
} as const;

export type MatchPosting = Pick<
  NormalizedPosting,
  "title" | "roleFamily" | "seniority" | "locations" | "salary" | "sponsorshipStatement" | "descriptionText" | "postedAt"
>;

export interface MatchInput {
  preferences: Preferences;
  resumeSkills: string[];
  experienceMonths: number;
  posting: MatchPosting;
  /** Cosine similarity of resume and posting embeddings, 0..1. Omit when not available. */
  semanticSimilarity?: number;
  /** Certified LCA filings for this employer in the last fiscal year, when known. */
  sponsorFilings?: number;
  now?: Date;
}

export type ExcludeReason = "location" | "sponsorship_denied" | "salary_below_min";

export interface MatchResult {
  score: number; // 0..100, 0 when excluded
  excluded: ExcludeReason | null;
  reasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  modelVersion: string;
}

const SENIORITY_RANK: Record<string, number> = { intern: 0, entry: 1, mid: 2, senior: 3, staff: 4, manager: 4, director: 5, executive: 6 };

export function scoreMatch(input: MatchInput): MatchResult {
  const { preferences: prefs, posting } = input;
  const now = input.now ?? new Date();
  const base = { matchedSkills: [] as string[], missingSkills: [] as string[], modelVersion: MATCH_MODEL_VERSION };

  // 1. Hard filters
  if (!locationOk(prefs, posting)) return { ...base, score: 0, excluded: "location", reasons: ["Outside your locations"] };
  if (prefs.needsSponsorship && posting.sponsorshipStatement === "denies") {
    return { ...base, score: 0, excluded: "sponsorship_denied", reasons: ["Posting says no visa sponsorship"] };
  }
  if (prefs.salaryMinUsd && posting.salary && posting.salary.maxUsd < prefs.salaryMinUsd * 0.9) {
    return { ...base, score: 0, excluded: "salary_below_min", reasons: ["Pay is below your minimum"] };
  }

  const reasons: string[] = [];
  let score = 0;

  // 2. Semantic similarity (embeddings). Neutral midpoint when unknown.
  const sem = clamp01(input.semanticSimilarity ?? 0.5);
  // Cosine scores for related text cluster in roughly 0.2..0.8; stretch that range.
  score += WEIGHTS.semantic * clamp01((sem - 0.2) / 0.6);

  // 3. Role fit: same family as any target role, or title token overlap.
  const targetFamilies = new Set(prefs.targetRoles.map(roleFamily));
  const titleTokens = tokens(posting.title);
  const bestOverlap = Math.max(0, ...prefs.targetRoles.map((r) => jaccard(tokens(r), titleTokens)));
  const familyHit = targetFamilies.has(posting.roleFamily);
  const roleFit = Math.max(familyHit ? 0.7 : 0, bestOverlap);
  score += WEIGHTS.role * roleFit;
  if (familyHit || bestOverlap >= 0.5) reasons.push("Matches your target role");

  // 4. Skills: share of the posting's recognised skills that the resume has.
  const jdSkills = skillsMentioned(posting.descriptionText);
  const have = new Set(canonicalize(input.resumeSkills));
  const matched = jdSkills.filter((s) => have.has(s));
  const missing = jdSkills.filter((s) => !have.has(s));
  const skillFit = jdSkills.length ? matched.length / jdSkills.length : 0.5;
  score += WEIGHTS.skills * skillFit;
  if (matched.length) reasons.push(`You have ${matched.length} of ${jdSkills.length} listed skills`);

  // 5. Seniority: penalise big gaps, either direction.
  const expected = posting.seniority ? SENIORITY_RANK[posting.seniority] : undefined;
  const mine = prefs.seniority ? SENIORITY_RANK[prefs.seniority] : seniorityFromMonths(input.experienceMonths);
  const seniorityFit = expected === undefined || mine === undefined ? 0.6 : Math.max(0, 1 - Math.abs(expected - mine) * 0.4);
  score += WEIGHTS.seniority * seniorityFit;

  // 6. Salary: bonus when pay is known and meets the minimum.
  if (posting.salary && prefs.salaryMinUsd && posting.salary.maxUsd >= prefs.salaryMinUsd) {
    score += WEIGHTS.salary;
    reasons.push("Pay meets your minimum");
  } else if (!prefs.salaryMinUsd) {
    score += WEIGHTS.salary * 0.5;
  }

  // 7. Freshness: full credit under 7 days, none after 45.
  if (posting.postedAt) {
    const days = (now.getTime() - new Date(posting.postedAt).getTime()) / 86_400_000;
    score += WEIGHTS.freshness * clamp01(1 - (days - 7) / 38);
    if (days <= 3) reasons.push("Posted in the last 3 days");
  }

  if (prefs.needsSponsorship) {
    if (posting.sponsorshipStatement === "offers") reasons.push("Posting offers visa sponsorship");
    else if (input.sponsorFilings) reasons.push(`Employer filed ${input.sponsorFilings} H-1B LCAs last year`);
  }

  return {
    score: Math.round(Math.min(100, score)),
    excluded: null,
    reasons,
    matchedSkills: matched,
    missingSkills: missing.slice(0, 5),
    modelVersion: MATCH_MODEL_VERSION,
  };
}

function locationOk(prefs: Preferences, p: MatchPosting): boolean {
  if (p.locations.length === 0) return true;
  const wantsRemote = prefs.remote === "remote";
  return p.locations.some((l) => {
    const country = l.country ?? "US";
    if (l.remote === "remote") {
      // Remote roles are fine when in a country the user targets (default US).
      const countries = prefs.locations.length ? prefs.locations.map((x) => x.country) : ["US"];
      return countries.includes(country);
    }
    if (wantsRemote) return false;
    if (prefs.locations.length === 0) return true;
    return prefs.locations.some(
      (want) =>
        want.country === country &&
        (!want.region || !l.region || want.region.toUpperCase() === l.region.toUpperCase()) &&
        (!want.city || !l.city || want.city.toLowerCase() === l.city.toLowerCase()),
    );
  });
}

function seniorityFromMonths(m: number): number {
  if (m < 12) return 1;
  if (m < 48) return 2;
  if (m < 96) return 3;
  return 4;
}

const STOP = new Set(["the", "and", "of", "for", "a", "an", "to", "in", "i", "ii", "iii", "sr", "jr", "senior", "junior", "lead", "staff"]);
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t && !STOP.has(t)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
