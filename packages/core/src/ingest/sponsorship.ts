const DENIES = [
  /\b(not|unable to|cannot|can ?not|won'?t|will not|do not|does not)\s+(be\s+able\s+to\s+)?(offer|provide|support|sponsor)\w*\s+(\w+\s+){0,4}(visa|sponsorship|h-?1b)/i,
  /\bno\s+(visa\s+)?sponsorship\b/i,
  /\bsponsorship\s+(is\s+)?not\s+(available|offered|provided)\b/i,
  /\bmust be (authorized|eligible) to work in the (u\.?s\.?|united states) without (current or future )?sponsorship\b/i,
  /\b(us citizens?|u\.s\. citizens?) only\b/i,
];
const OFFERS = [
  /\b(visa|h-?1b)\s+sponsorship\s+(is\s+)?(available|offered|provided)\b/i,
  /\b(we|will)\s+(sponsor|offer sponsorship)\b/i,
  /\bopen to sponsor/i,
];

/** Classifies an explicit sponsorship statement in a job description. "unknown" is the common case. */
export function sponsorshipStatement(text: string): "offers" | "denies" | "unknown" {
  if (DENIES.some((re) => re.test(text))) return "denies";
  if (OFFERS.some((re) => re.test(text))) return "offers";
  return "unknown";
}
