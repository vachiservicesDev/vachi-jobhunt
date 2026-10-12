import { describe, expect, it } from "vitest";
import { normalizeEmployerName, redactContact, ResumeDocument, totalExperienceMonths } from "../src/index.ts";

describe("normalizeEmployerName", () => {
  it.each([
    ["Google, L.L.C.", "google"],
    ["GOOGLE LLC", "google"],
    ["Amazon.com Services LLC", "amazoncom services"],
    ["Ernst & Young U.S. LLP", "ernst and young"],
    ["The Goldman Sachs Group, Inc.", "goldman sachs"],
  ])("%s → %s", (raw, expected) => expect(normalizeEmployerName(raw)).toBe(expected));
});

describe("resume helpers", () => {
  const doc = ResumeDocument.parse({
    schemaVersion: 1,
    contact: { name: "A Person", email: "a@example.com", links: [] },
    experience: [
      { id: "e1", company: "X", title: "Engineer", start: "2020-01", end: "2022-01" },
      { id: "e2", company: "Y", title: "Senior Engineer", start: "2022-02", end: null },
    ],
  });
  it("redacts contact before AI calls", () => {
    expect(redactContact(doc).contact).toEqual({ links: [] });
  });
  it("sums experience months", () => {
    expect(totalExperienceMonths(doc, new Date("2026-02-15T00:00:00Z"))).toBe(24 + 48);
  });
});
