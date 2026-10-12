import type { ParsedLocation, RemoteType } from "../schemas/posting.ts";

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const STATE_CODES = new Set(Object.values(US_STATES));

const COUNTRIES: Record<string, string> = {
  "united states": "US", usa: "US", us: "US", "u.s.": "US", canada: "CA", "united kingdom": "GB",
  uk: "GB", india: "IN", germany: "DE", ireland: "IE", netherlands: "NL", australia: "AU",
};

export function remoteTypeOf(text: string): RemoteType {
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(remote|work from home|wfh|distributed)\b/i.test(text)) return "remote";
  if (/\b(on-?site|in office|in-office)\b/i.test(text)) return "onsite";
  return "unknown";
}

/** Splits a board's free-text location ("NYC or SF; Remote (US)") into structured locations. */
export function parseLocations(raw: string): ParsedLocation[] {
  const parts = raw
    .split(/;|\bor\b|\/|\|/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  return parts.map(parseOne);
}

function parseOne(raw: string): ParsedLocation {
  const remote = remoteTypeOf(raw);
  const cleaned = raw.replace(/\(.*?\)/g, (m) => (/(us|usa|united states)/i.test(m) ? ", US" : "")).replace(/\b(remote|hybrid|on-?site)\b[:\s-]*/gi, "");
  const tokens = cleaned.split(",").map((t) => t.trim()).filter(Boolean);
  const loc: ParsedLocation = { raw, remote };

  for (const t of [...tokens].reverse()) {
    const lower = t.toLowerCase();
    if (!loc.country && COUNTRIES[lower]) { loc.country = COUNTRIES[lower]; continue; }
    if (!loc.region && (STATE_CODES.has(t.toUpperCase()) && t.length === 2)) { loc.region = t.toUpperCase(); loc.country ??= "US"; continue; }
    if (!loc.region && US_STATES[lower]) { loc.region = US_STATES[lower]; loc.country ??= "US"; continue; }
    if (!loc.city) loc.city = t;
  }
  if (remote === "remote" && !loc.country && /\b(us|usa|united states)\b/i.test(raw)) loc.country = "US";
  return loc;
}
