import { z } from "zod";

/**
 * Canonical structured resume. Parsers and the tailoring pipeline both produce
 * this shape. Bump RESUME_SCHEMA_VERSION on breaking changes and add a migrator.
 */
export const RESUME_SCHEMA_VERSION = 1 as const;

const YearMonth = z.string().regex(/^\d{4}(-\d{2})?$/, "Use YYYY or YYYY-MM");

export const Experience = z.object({
  id: z.string(),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().optional(),
  start: YearMonth.optional(),
  end: YearMonth.nullable().optional(), // null = present
  bullets: z.array(z.object({ id: z.string(), text: z.string().min(1) })).default([]),
});
export type Experience = z.infer<typeof Experience>;

export const Education = z.object({
  id: z.string(),
  institution: z.string().min(1),
  degree: z.string().optional(),
  field: z.string().optional(),
  end: YearMonth.optional(),
});

export const ResumeDocument = z.object({
  schemaVersion: z.literal(RESUME_SCHEMA_VERSION),
  // Contact details are kept, but stripped before any AI call (see redactContact).
  contact: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      location: z.string().optional(),
      links: z.array(z.string()).default([]),
    })
    .default({ links: [] }),
  headline: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string().min(1)).default([]),
  experience: z.array(Experience).default([]),
  education: z.array(Education).default([]),
  certifications: z.array(z.string()).default([]),
});
export type ResumeDocument = z.infer<typeof ResumeDocument>;

/** Returns a copy safe to send to third-party model providers. */
export function redactContact(doc: ResumeDocument): ResumeDocument {
  return { ...doc, contact: { links: [] } };
}

/** Total months of experience, used by the seniority signal in matching. */
export function totalExperienceMonths(doc: ResumeDocument, now = new Date()): number {
  let months = 0;
  for (const e of doc.experience) {
    if (!e.start) continue;
    const start = toMonthIndex(e.start);
    const end = e.end ? toMonthIndex(e.end) : now.getUTCFullYear() * 12 + now.getUTCMonth();
    if (end > start) months += end - start;
  }
  return months;
}

function toMonthIndex(ym: string): number {
  const [y, m] = ym.split("-");
  return Number(y) * 12 + (m ? Number(m) - 1 : 0);
}
