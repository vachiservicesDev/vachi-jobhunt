export function formatSalary(min: number | null, max: number | null): string | null {
  if (!min || !max) return null;
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  return min === max ? k(min) : `${k(min)} to ${k(max)}`;
}

export function formatLocations(locs: Array<{ raw: string; city?: string; region?: string; remote: string }>): string {
  if (!locs.length) return "Location not listed";
  const first = locs[0]!;
  const label = first.remote === "remote" ? "Remote" : [first.city, first.region].filter(Boolean).join(", ") || first.raw;
  return locs.length > 1 ? `${label} +${locs.length - 1}` : label;
}

export function formatAge(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} mo ago`;
}
