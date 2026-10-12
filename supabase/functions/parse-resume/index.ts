// POST { resume_id } — parses an uploaded resume into a ResumeDocument version,
// embeds it, and refreshes the user's feed. The client uploads the file to
// storage (resumes/{user_id}/...) and inserts the resumes row first.
import { RESUME_SCHEMA_VERSION, ResumeDocument, redactContact, totalExperienceMonths, canonicalize } from "@vachi/core";
import { z } from "zod";
import { requireUser, serviceClient, userClient } from "../_shared/clients.ts";
import { HttpError, handler, json } from "../_shared/http.ts";
import { runTask } from "../_shared/ai/gateway.ts";
import { RESUME_PARSE, type ResumeExtraction } from "../_shared/ai/prompts.ts";
import { EMBEDDING_MODEL, embed, toVector } from "../_shared/ai/embeddings.ts";
import { extractResumeText } from "../_shared/extract.ts";
import { scoreUser } from "../_shared/scoring.ts";

const Body = z.object({ resume_id: z.uuid() });

Deno.serve(handler(async (req) => {
  const asUser = userClient(req);
  const userId = await requireUser(asUser);
  const { resume_id } = Body.parse(await req.json());

  // Ownership check under RLS: the user can only see their own resume rows.
  const { data: resume } = await asUser.from("resumes").select("id, storage_path, mime_type, parse_status").eq("id", resume_id).maybeSingle();
  if (!resume) throw new HttpError(404, "not_found", "Resume not found.");
  if (resume.parse_status === "parsing") throw new HttpError(409, "in_progress", "This resume is already being read.");

  const db = serviceClient();
  const { data: ok, error: quotaError } = await db.schema("billing").rpc("consume_quota", { p_user: userId, p_feature: "parse" });
  if (quotaError) throw quotaError;
  if (ok === false) throw new HttpError(429, "quota_exceeded", "You've reached this month's resume uploads.");

  await db.from("resumes").update({ parse_status: "parsing", parse_error: null }).eq("id", resume_id);
  try {
    const file = await db.storage.from("resumes").download(resume.storage_path);
    if (file.error) throw new HttpError(404, "file_missing", "The uploaded file is missing. Upload it again.");
    const text = await extractResumeText(new Uint8Array(await file.data.arrayBuffer()), resume.mime_type);

    const extracted = await runTask(db, userId, RESUME_PARSE, text);
    const doc = toResumeDocument(extracted);
    const months = totalExperienceMonths(doc);

    // Embed what matters for matching; contact details never leave our systems for this.
    const safe = redactContact(doc);
    const embedText = [safe.headline, safe.summary, safe.skills.join(", "), ...safe.experience.map((e) => `${e.title} at ${e.company}. ${e.bullets.map((b) => b.text).join(" ")}`)]
      .filter(Boolean).join("\n");
    const [vector] = await embed([embedText], "query");

    const { error } = await db.from("resume_versions").insert({
      resume_id, user_id: userId, source: "upload", schema_version: RESUME_SCHEMA_VERSION, document: doc,
      skills: canonicalize(doc.skills), experience_months: months,
      embedding: vector ? toVector(vector) : null, embedding_model: EMBEDDING_MODEL, prompt_version: RESUME_PARSE.promptVersion,
    });
    if (error) throw error;

    // The first parsed resume becomes primary.
    const { count } = await db.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_primary", true);
    await db.from("resumes").update({ parse_status: "parsed", ...(count ? {} : { is_primary: true }) }).eq("id", resume_id);

    const feed = await scoreUser(db, userId);
    return json({ resume_id, document: doc, feed });
  } catch (e) {
    const message = e instanceof HttpError ? e.message : "We couldn't read this resume.";
    await db.from("resumes").update({ parse_status: "failed", parse_error: message }).eq("id", resume_id);
    throw e;
  }
}));

function toResumeDocument(x: ResumeExtraction): ResumeDocument {
  const ym = (v: string | null) => (v && /^\d{4}(-\d{2})?$/.test(v) ? v : undefined);
  return ResumeDocument.parse({
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { name: x.name ?? undefined, email: x.email ?? undefined, phone: x.phone ?? undefined, location: x.location ?? undefined, links: x.links },
    headline: x.headline ?? undefined,
    summary: x.summary ?? undefined,
    skills: [...new Set(x.skills.map((s) => s.trim()).filter(Boolean))],
    experience: x.experience.map((e, i) => ({
      id: `e${i + 1}`, company: e.company, title: e.title, location: e.location ?? undefined,
      start: ym(e.start), end: e.end === null ? null : ym(e.end),
      bullets: e.bullets.filter(Boolean).map((t, j) => ({ id: `e${i + 1}b${j + 1}`, text: t })),
    })),
    education: x.education.map((ed, i) => ({ id: `ed${i + 1}`, institution: ed.institution, degree: ed.degree ?? undefined, field: ed.field ?? undefined, end: ym(ed.end) })),
    certifications: x.certifications,
  });
}
