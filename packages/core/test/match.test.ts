import { describe, expect, it } from "vitest";
import { Preferences, scoreMatch, type MatchPosting } from "../src/index.ts";

const now = new Date("2026-10-09T00:00:00Z");
const prefs = Preferences.parse({ targetRoles: ["Software Engineer"], locations: [{ city: "Seattle", region: "WA", country: "US" }], salaryMinUsd: 140000 });
const posting: MatchPosting = {
  title: "Senior Software Engineer",
  roleFamily: "software_engineering",
  seniority: "senior",
  locations: [{ raw: "Seattle, WA", city: "Seattle", region: "WA", country: "US", remote: "hybrid" }],
  salary: { minUsd: 150000, maxUsd: 190000 },
  sponsorshipStatement: "unknown",
  descriptionText: "We use TypeScript, React, AWS and PostgreSQL. Kubernetes a plus.",
  postedAt: "2026-10-08T00:00:00Z",
};
const base = { preferences: prefs, resumeSkills: ["TypeScript", "React", "Postgres"], experienceMonths: 72, posting, now };

describe("scoreMatch", () => {
  it("scores a strong match highly with reasons", () => {
    const r = scoreMatch({ ...base, semanticSimilarity: 0.7 });
    expect(r.excluded).toBeNull();
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.matchedSkills).toEqual(expect.arrayContaining(["typescript", "react", "postgresql"]));
    expect(r.missingSkills).toEqual(expect.arrayContaining(["aws", "kubernetes"]));
    expect(r.reasons).toContain("Matches your target role");
  });

  it("is monotonic in semantic similarity", () => {
    expect(scoreMatch({ ...base, semanticSimilarity: 0.8 }).score).toBeGreaterThan(scoreMatch({ ...base, semanticSimilarity: 0.3 }).score);
  });

  it("excludes wrong location", () => {
    const r = scoreMatch({ ...base, posting: { ...posting, locations: [{ raw: "Austin, TX", city: "Austin", region: "TX", country: "US", remote: "onsite" }] } });
    expect(r).toMatchObject({ score: 0, excluded: "location" });
  });

  it("allows US-remote roles for a US user", () => {
    const r = scoreMatch({ ...base, posting: { ...posting, locations: [{ raw: "Remote (US)", country: "US", remote: "remote" }] } });
    expect(r.excluded).toBeNull();
  });

  it("excludes postings that deny sponsorship when the user needs it", () => {
    const r = scoreMatch({ ...base, preferences: { ...prefs, needsSponsorship: true }, posting: { ...posting, sponsorshipStatement: "denies" } });
    expect(r.excluded).toBe("sponsorship_denied");
  });

  it("adds sponsor history as a reason", () => {
    const r = scoreMatch({ ...base, preferences: { ...prefs, needsSponsorship: true }, sponsorFilings: 812 });
    expect(r.reasons).toContain("Employer filed 812 H-1B LCAs last year");
  });

  it("excludes pay well below minimum", () => {
    const r = scoreMatch({ ...base, posting: { ...posting, salary: { minUsd: 90000, maxUsd: 110000 } } });
    expect(r.excluded).toBe("salary_below_min");
  });

  it("stays within 0..100", () => {
    const r = scoreMatch({ ...base, semanticSimilarity: 1.5 });
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
