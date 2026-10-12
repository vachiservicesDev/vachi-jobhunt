import { z } from "zod";

export const SourceKind = z.enum(["greenhouse", "lever", "ashby", "usajobs"]);
export type SourceKind = z.infer<typeof SourceKind>;

export const RemoteType = z.enum(["onsite", "hybrid", "remote", "unknown"]);
export type RemoteType = z.infer<typeof RemoteType>;

export const ParsedLocation = z.object({
  raw: z.string(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().length(2).optional(),
  remote: RemoteType,
});
export type ParsedLocation = z.infer<typeof ParsedLocation>;

export const SalaryRange = z.object({
  minUsd: z.number().int().nonnegative(),
  maxUsd: z.number().int().nonnegative(),
});
export type SalaryRange = z.infer<typeof SalaryRange>;

/** Output of every source adapter; the ingestion worker upserts this shape. */
export const NormalizedPosting = z.object({
  source: SourceKind,
  externalId: z.string().min(1),
  companyName: z.string().min(1),
  title: z.string().min(1),
  normalizedTitle: z.string().min(1),
  roleFamily: z.string(),
  seniority: z.string().optional(),
  locations: z.array(ParsedLocation),
  salary: SalaryRange.nullable(),
  descriptionText: z.string(),
  applyUrl: z.url(),
  postedAt: z.string().datetime().nullable(),
  sponsorshipStatement: z.enum(["offers", "denies", "unknown"]),
  contentHash: z.string(),
});
export type NormalizedPosting = z.infer<typeof NormalizedPosting>;
