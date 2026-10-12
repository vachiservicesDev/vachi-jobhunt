/** Role families used for coarse matching and feed fan-out. Order matters: first match wins. */
const FAMILIES: Array<[family: string, pattern: RegExp]> = [
  ["data_science", /\b(data scien|machine learning|ml engineer|ai engineer|applied scientist|research scientist)/i],
  ["data_engineering", /\b(data engineer|analytics engineer|etl|data platform)/i],
  ["data_analytics", /\b(data analyst|business intelligence|bi analyst|analytics)/i],
  ["devops_sre", /\b(devops|site reliability|sre\b|platform engineer|infrastructure engineer|cloud engineer)/i],
  ["security", /\b(security|appsec|infosec|penetration)/i],
  ["mobile", /\b(ios|android|mobile|react native)/i],
  ["frontend", /\b(front[- ]?end|ui engineer|web developer)/i],
  ["qa", /\b(qa\b|quality assurance|test engineer|sdet)/i],
  ["software_engineering", /\b(software|developer|engineer|programmer|full[- ]?stack|back[- ]?end)\b/i],
  ["product_management", /\b(product manager|product owner|\bpm\b)/i],
  ["design", /\b(designer|ux|ui\/ux|product design)/i],
  ["project_management", /\b(project manager|program manager|scrum master|delivery manager)/i],
  ["sales", /\b(account executive|sales|business development|sdr\b|bdr\b)/i],
  ["marketing", /\b(marketing|growth|seo|content strateg|brand)/i],
  ["customer_success", /\b(customer success|support|account manager)/i],
  ["finance", /\b(accountant|finance|fp&a|controller|auditor)/i],
  ["hr_recruiting", /\b(recruit|talent|human resources|hr\b|people partner)/i],
  ["operations", /\b(operations|ops\b|supply chain|logistics)/i],
];

const SENIORITY: Array<[level: string, pattern: RegExp]> = [
  ["intern", /\b(intern|internship|co-?op)\b/i],
  ["executive", /\b(vp|vice president|chief|cto|ceo|cfo|head of)\b/i],
  ["director", /\bdirector\b/i],
  ["manager", /\b(manager|lead)\b/i],
  ["staff", /\b(staff|principal|distinguished)\b/i],
  ["senior", /\b(senior|sr\.?|iii|iv)\b/i],
  ["entry", /\b(junior|jr\.?|entry|associate|new grad|graduate|i)\b/i],
];

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[-–—|,/].*(remote|hybrid|onsite|us|usa|united states).*$/i, " ")
    .replace(/[^a-z0-9+#.& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function roleFamily(title: string): string {
  for (const [family, re] of FAMILIES) if (re.test(title)) return family;
  return "other";
}

export function seniorityOf(title: string): string | undefined {
  // Manager titles that are really product/project roles are classified by family, not seniority.
  if (/\b(product|project|program|account) manager\b/i.test(title) && !/\bsenior|sr\b/i.test(title)) return "mid";
  for (const [level, re] of SENIORITY) if (re.test(title)) return level;
  return undefined;
}
