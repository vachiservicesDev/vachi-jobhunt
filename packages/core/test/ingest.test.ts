import { describe, expect, it } from "vitest";
import { ashby, dedupeKey, greenhouse, htmlToText, lever, parseLocations, parseSalary, roleFamily, seniorityOf, sponsorshipStatement } from "../src/index.ts";
import { NormalizedPosting } from "../src/schemas/posting.ts";

describe("parseSalary", () => {
  it.each([
    ["Base pay: $140,000 - $180,000 per year", { minUsd: 140000, maxUsd: 180000 }],
    ["$120k–$150k", { minUsd: 120000, maxUsd: 150000 }],
    ["$55 - $70 per hour", { minUsd: 114400, maxUsd: 145600 }],
    ["$95,000 to $110,000 USD", { minUsd: 95000, maxUsd: 110000 }],
  ])("%s", (text, expected) => expect(parseSalary(text)).toEqual(expected));

  it("returns null without a USD range", () => {
    expect(parseSalary("Competitive salary and equity")).toBeNull();
    expect(parseSalary("€60,000 - €70,000")).toBeNull();
  });
});

describe("parseLocations", () => {
  it("splits multi-location strings", () => {
    const locs = parseLocations("San Francisco, CA; New York, NY");
    expect(locs.map((l) => [l.city, l.region, l.country])).toEqual([["San Francisco", "CA", "US"], ["New York", "NY", "US"]]);
  });
  it("detects remote with country", () => {
    expect(parseLocations("Remote (US)")[0]).toMatchObject({ remote: "remote", country: "US" });
  });
  it("handles full state names and hybrid", () => {
    expect(parseLocations("Hybrid - Austin, Texas")[0]).toMatchObject({ remote: "hybrid", city: "Austin", region: "TX" });
  });
});

describe("titles", () => {
  it("classifies role family and seniority", () => {
    expect(roleFamily("Senior Software Engineer, Backend")).toBe("software_engineering");
    expect(roleFamily("Machine Learning Engineer")).toBe("data_science");
    expect(roleFamily("Senior Product Manager")).toBe("product_management");
    expect(seniorityOf("Senior Software Engineer")).toBe("senior");
    expect(seniorityOf("Software Engineer II")).toBeUndefined();
    expect(seniorityOf("Staff Engineer")).toBe("staff");
    expect(seniorityOf("Software Engineering Intern")).toBe("intern");
  });
});

describe("sponsorshipStatement", () => {
  it("detects denials", () => {
    expect(sponsorshipStatement("We are unable to sponsor visas for this role.")).toBe("denies");
    expect(sponsorshipStatement("Candidates must be authorized to work in the United States without sponsorship.")).toBe("denies");
    expect(sponsorshipStatement("No visa sponsorship is available.")).toBe("denies");
  });
  it("detects offers and unknown", () => {
    expect(sponsorshipStatement("H-1B sponsorship is available for this position.")).toBe("offers");
    expect(sponsorshipStatement("Great benefits.")).toBe("unknown");
  });
});

describe("htmlToText", () => {
  it("decodes double-escaped Greenhouse HTML", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;TypeScript&lt;/li&gt;&lt;/ul&gt;")).toBe("Hello & welcome\n- TypeScript");
  });
});

const cfg = (kind: "greenhouse" | "lever" | "ashby") => ({ kind, token: "acme", companyName: "Acme Inc" });

describe("adapters", () => {
  it("parses Greenhouse", () => {
    const [p] = greenhouse.parse(
      { jobs: [{ id: 42, title: "Senior Software Engineer", absolute_url: "https://boards.greenhouse.io/acme/jobs/42", first_published: "2026-10-01T00:00:00Z", location: { name: "Remote (US)" }, content: "&lt;p&gt;TypeScript and AWS. $150,000 - $190,000&lt;/p&gt;" }] },
      cfg("greenhouse"),
    );
    expect(NormalizedPosting.parse(p)).toBeTruthy();
    expect(p).toMatchObject({ externalId: "42", roleFamily: "software_engineering", seniority: "senior", salary: { minUsd: 150000, maxUsd: 190000 } });
    expect(p!.locations[0]).toMatchObject({ remote: "remote", country: "US" });
  });

  it("parses Lever with structured salary and workplace type", () => {
    const [p] = lever.parse(
      [{ id: "abc", text: "Data Engineer", hostedUrl: "https://jobs.lever.co/acme/abc", applyUrl: "https://jobs.lever.co/acme/abc/apply", createdAt: 1759276800000, categories: { location: "Seattle, WA" }, workplaceType: "hybrid", description: "<p>Spark and Airflow</p>", lists: [{ text: "Requirements", content: "<li>Python</li>" }], salaryRange: { min: 130000, max: 160000, currency: "USD", interval: "per-year-salary" } }],
      cfg("lever"),
    );
    expect(NormalizedPosting.parse(p)).toBeTruthy();
    expect(p).toMatchObject({ roleFamily: "data_engineering", salary: { minUsd: 130000, maxUsd: 160000 }, applyUrl: "https://jobs.lever.co/acme/abc/apply" });
    expect(p!.locations[0]).toMatchObject({ city: "Seattle", region: "WA", remote: "hybrid" });
  });

  it("parses Ashby and skips unlisted jobs", () => {
    const out = ashby.parse(
      { jobs: [
        { id: "1", title: "Product Designer", location: "New York, NY", workplaceType: "OnSite", descriptionHtml: "<p>Figma</p>", publishedAt: "2026-10-05T00:00:00Z", jobUrl: "https://jobs.ashbyhq.com/acme/1", compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 120000, maxValue: 140000 }] } },
        { id: "2", title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/acme/2", isListed: false },
      ] },
      cfg("ashby"),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ roleFamily: "design", salary: { minUsd: 120000, maxUsd: 140000 } });
    expect(out[0]!.locations[0]!.remote).toBe("onsite");
  });

  it("gives the same dedupe key across boards", () => {
    const a = { companyName: "Acme Inc", normalizedTitle: "data engineer", locations: [{ raw: "x", city: "Seattle", region: "WA", country: "US", remote: "hybrid" as const }] };
    expect(dedupeKey(a)).toBe(dedupeKey({ ...a, companyName: "ACME INC" }));
  });
});
