import type { NormalizedPosting, SourceKind } from "../schemas/posting.ts";
import { parseLocations } from "./location.ts";
import { parseSalary } from "./salary.ts";
import { sponsorshipStatement } from "./sponsorship.ts";
import { htmlToText, stableHash } from "./text.ts";
import { normalizeTitle, roleFamily, seniorityOf } from "./title.ts";

export interface RawPostingFields {
  source: SourceKind;
  externalId: string;
  companyName: string;
  title: string;
  locationText: string;
  descriptionHtml: string;
  applyUrl: string;
  postedAt?: string | number | null;
  /** Structured salary from the source when it has one; preferred over text parsing. */
  salary?: { minUsd: number; maxUsd: number } | null;
  /** Explicit workplace type from the source, when it has one. */
  workplaceType?: "onsite" | "hybrid" | "remote" | null;
}

/** Shared tail of every adapter: turns source fields into a NormalizedPosting. */
export function buildPosting(f: RawPostingFields): NormalizedPosting {
  const descriptionText = htmlToText(f.descriptionHtml);
  const locations = parseLocations(f.locationText || "Unknown");
  if (f.workplaceType) for (const l of locations) if (l.remote === "unknown") l.remote = f.workplaceType;
  const salary = f.salary ?? parseSalary(descriptionText);
  const postedAt = toIso(f.postedAt);
  return {
    source: f.source,
    externalId: f.externalId,
    companyName: f.companyName.trim(),
    title: f.title.trim(),
    normalizedTitle: normalizeTitle(f.title),
    roleFamily: roleFamily(f.title),
    seniority: seniorityOf(f.title),
    locations,
    salary,
    descriptionText,
    applyUrl: f.applyUrl,
    postedAt,
    sponsorshipStatement: sponsorshipStatement(descriptionText),
    contentHash: stableHash([f.title, f.locationText, descriptionText, f.applyUrl].join("\u0000")),
  };
}

function toIso(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Dedupe key for the same job listed on several boards. */
export function dedupeKey(p: Pick<NormalizedPosting, "companyName" | "normalizedTitle" | "locations">): string {
  const loc = p.locations[0];
  const where = loc ? `${loc.city ?? ""}|${loc.region ?? ""}|${loc.country ?? ""}|${loc.remote}` : "";
  return stableHash(`${p.companyName.toLowerCase()}|${p.normalizedTitle}|${where.toLowerCase()}`);
}
