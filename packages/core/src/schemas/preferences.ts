import { z } from "zod";

export const RemotePreference = z.enum(["onsite", "hybrid", "remote", "any"]);
export type RemotePreference = z.infer<typeof RemotePreference>;

export const LocationPreference = z.object({
  city: z.string().trim().min(1).optional(),
  region: z.string().trim().min(1).optional(),
  country: z.string().trim().length(2).default("US"),
});
export type LocationPreference = z.infer<typeof LocationPreference>;

export const Preferences = z
  .object({
    targetRoles: z.array(z.string().trim().min(2).max(80)).min(1).max(5),
    locations: z.array(LocationPreference).max(10).default([]),
    remote: RemotePreference.default("any"),
    salaryMinUsd: z.number().int().nonnegative().max(2_000_000).nullable().default(null),
    needsSponsorship: z.boolean().default(false),
    seniority: z.enum(["intern", "entry", "mid", "senior", "staff", "manager", "director", "executive"]).optional(),
  })
  .strict();
export type Preferences = z.infer<typeof Preferences>;
