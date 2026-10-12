/**
 * Small, curated skill vocabulary used to find skill mentions in job descriptions
 * deterministically. The LLM keyword-gap feature (week 3) extends this per job;
 * this list keeps the feed score cheap and explainable.
 */
export const SKILL_VOCAB: readonly string[] = [
  // languages
  "javascript", "typescript", "python", "java", "kotlin", "swift", "go", "golang", "rust", "c++", "c#", "ruby", "php", "scala", "sql", "r",
  // frameworks and runtimes
  "react", "react native", "next.js", "node.js", "angular", "vue", "django", "flask", "fastapi", "spring", "spring boot", ".net", "rails", "graphql", "rest",
  // data and ml
  "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "spark", "airflow", "dbt", "snowflake", "bigquery", "redshift", "databricks", "kafka", "tableau", "power bi", "looker", "llm", "nlp", "computer vision",
  // infra
  "aws", "gcp", "azure", "kubernetes", "docker", "terraform", "ci/cd", "linux", "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch",
  // practice
  "agile", "scrum", "jira", "figma", "a/b testing", "microservices", "system design", "distributed systems", "security", "salesforce", "hubspot", "excel", "sap",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const PATTERNS = SKILL_VOCAB.map((s) => [s, new RegExp(`(^|[^a-z0-9])${escape(s)}($|[^a-z0-9+#])`, "i")] as const);

export function skillsMentioned(text: string): string[] {
  const found: string[] = [];
  for (const [s, re] of PATTERNS) if (re.test(text)) found.push(s);
  return canonicalize(found);
}

const ALIASES: Record<string, string> = { golang: "go", postgres: "postgresql" };
export function canonicalize(skills: string[]): string[] {
  return [...new Set(skills.map((s) => ALIASES[s.toLowerCase()] ?? s.toLowerCase()))];
}
