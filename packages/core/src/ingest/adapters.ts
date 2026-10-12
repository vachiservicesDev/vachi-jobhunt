import type { NormalizedPosting, SourceKind } from "../schemas/posting.ts";
import { buildPosting } from "./normalize.ts";

/**
 * Source adapters are pure: (raw JSON, source config) → postings. Fetching lives in
 * the worker so adapters can be unit-tested with fixtures and run in any runtime.
 */
export interface SourceConfig {
  kind: SourceKind;
  /** Board token / company slug / org name, depending on the source. */
  token: string;
  companyName: string;
}

export interface SourceAdapter {
  url(cfg: SourceConfig): string;
  parse(raw: unknown, cfg: SourceConfig): NormalizedPosting[];
}

// Greenhouse Job Board API: GET /v1/boards/{token}/jobs?content=true
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  content?: string;
}

export const greenhouse: SourceAdapter = {
  url: (c) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.token)}/jobs?content=true`,
  parse(raw, c) {
    const jobs = (raw as { jobs?: GreenhouseJob[] }).jobs ?? [];
    return jobs.map((j) =>
      buildPosting({
        source: "greenhouse",
        externalId: String(j.id),
        companyName: c.companyName,
        title: j.title,
        locationText: j.location?.name ?? "",
        descriptionHtml: j.content ?? "",
        applyUrl: j.absolute_url,
        postedAt: j.first_published ?? j.updated_at ?? null,
      }),
    );
  },
};

// Lever Postings API: GET /v0/postings/{company}?mode=json
interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: { location?: string; allLocations?: string[] };
  workplaceType?: "onsite" | "hybrid" | "remote" | "unspecified";
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
  additional?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

export const lever: SourceAdapter = {
  url: (c) => `https://api.lever.co/v0/postings/${encodeURIComponent(c.token)}?mode=json`,
  parse(raw, c) {
    const list = Array.isArray(raw) ? (raw as LeverPosting[]) : [];
    return list.map((p) => {
      const html = [p.description ?? "", ...(p.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`), p.additional ?? ""].join("\n");
      const locs = p.categories?.allLocations?.length ? p.categories.allLocations.join("; ") : p.categories?.location ?? "";
      const sr = p.salaryRange;
      const salary =
        sr && sr.currency === "USD" && sr.min && sr.max && /year|annual/i.test(sr.interval ?? "")
          ? { minUsd: Math.round(sr.min), maxUsd: Math.round(sr.max) }
          : null;
      return buildPosting({
        source: "lever",
        externalId: p.id,
        companyName: c.companyName,
        title: p.text,
        locationText: locs,
        descriptionHtml: html,
        applyUrl: p.applyUrl ?? p.hostedUrl,
        postedAt: p.createdAt ?? null,
        salary,
        workplaceType: p.workplaceType && p.workplaceType !== "unspecified" ? p.workplaceType : null,
      });
    });
  },
};

// Ashby Job Board API: GET /posting-api/job-board/{org}?includeCompensation=true
interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: Array<{ location: string }>;
  isRemote?: boolean;
  workplaceType?: "OnSite" | "Hybrid" | "Remote";
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  isListed?: boolean;
  compensation?: {
    summaryComponents?: Array<{ compensationType: string; interval: string; currencyCode?: string; minValue?: number; maxValue?: number }>;
  };
}

export const ashby: SourceAdapter = {
  url: (c) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.token)}?includeCompensation=true`,
  parse(raw, c) {
    const jobs = (raw as { jobs?: AshbyJob[] }).jobs ?? [];
    return jobs
      .filter((j) => j.isListed !== false)
      .map((j) => {
        const salaryComp = j.compensation?.summaryComponents?.find(
          (s) => s.compensationType === "Salary" && s.currencyCode === "USD" && /YEAR/i.test(s.interval),
        );
        const workplace = j.workplaceType ? (j.workplaceType.toLowerCase() as "onsite" | "hybrid" | "remote") : j.isRemote ? "remote" : null;
        return buildPosting({
          source: "ashby",
          externalId: j.id,
          companyName: c.companyName,
          title: j.title,
          locationText: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join("; "),
          descriptionHtml: j.descriptionHtml ?? "",
          applyUrl: j.applyUrl ?? j.jobUrl,
          postedAt: j.publishedAt ?? null,
          salary: salaryComp?.minValue && salaryComp.maxValue ? { minUsd: Math.round(salaryComp.minValue), maxUsd: Math.round(salaryComp.maxValue) } : null,
          workplaceType: workplace,
        });
      });
  },
};

export const adapters: Partial<Record<SourceKind, SourceAdapter>> = { greenhouse, lever, ashby };
