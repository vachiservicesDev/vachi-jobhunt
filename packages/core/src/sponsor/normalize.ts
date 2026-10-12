const LEGAL_SUFFIXES = /\b(incorporated|inc|corporation|corp|company|co|llc|l\s?l\s?c|ltd|limited|lp|llp|plc|pllc|pc|gmbh|na|n\s?a|usa|us|holdings?|group)\b/g;

/**
 * Normalizes an employer name for matching DOL LCA filings to companies,
 * e.g. "Google, L.L.C." and "GOOGLE LLC" both become "google".
 */
export function normalizeEmployerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\./g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\b(the|dba)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
