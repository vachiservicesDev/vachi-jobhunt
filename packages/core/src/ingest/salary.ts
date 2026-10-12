import type { SalaryRange } from "../schemas/posting.ts";

const HOURS_PER_YEAR = 2080;

/**
 * Extracts an annual USD salary range from free text, for example
 * "$140,000 - $180,000", "$120k–$150k", "$55 - $70 per hour". Returns null if
 * no confident USD range is found. Non-USD amounts are ignored on purpose.
 */
export function parseSalary(text: string): SalaryRange | null {
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?\s*(?:-|–|—|to)\s*(?:USD\s*)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([kK])?(?:\s*(?:USD))?(\s*(?:\/|per|an|a)\s*(hour|hr|year|yr|annum))?/;
  const m = re.exec(text);
  if (!m) return null;
  const [, a, ak, b, bk, , unit] = m;
  let min = toNumber(a!, ak ?? bk);
  let max = toNumber(b!, bk ?? ak);
  if (min > max) [min, max] = [max, min];
  const hourly = unit ? /^h/i.test(unit) : max < 500;
  if (hourly) {
    min *= HOURS_PER_YEAR;
    max *= HOURS_PER_YEAR;
  }
  if (min < 10_000 || max > 5_000_000) return null;
  return { minUsd: Math.round(min), maxUsd: Math.round(max) };
}

function toNumber(n: string, k?: string): number {
  const v = Number(n.replace(/,/g, ""));
  return k ? v * 1000 : v;
}
