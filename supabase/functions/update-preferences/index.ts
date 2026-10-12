// POST Preferences (packages/core schema) — validates, saves, and refreshes the feed.
import { Preferences, roleFamily } from "@vachi/core";
import { requireUser, serviceClient, userClient } from "../_shared/clients.ts";
import { HttpError, handler, json } from "../_shared/http.ts";
import { scoreUser } from "../_shared/scoring.ts";

Deno.serve(handler(async (req) => {
  const asUser = userClient(req);
  const userId = await requireUser(asUser);
  const parsed = Preferences.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "invalid_preferences", parsed.error.issues[0]?.message ?? "Invalid preferences.");
  const p = parsed.data;

  // Written as the user, so RLS guarantees they can only change their own row.
  const { error } = await asUser.from("preferences").upsert({
    user_id: userId,
    target_roles: p.targetRoles,
    target_role_families: [...new Set(p.targetRoles.map(roleFamily))],
    locations: p.locations,
    remote: p.remote,
    salary_min_usd: p.salaryMinUsd,
    needs_sponsorship: p.needsSponsorship,
    seniority: p.seniority ?? null,
  });
  if (error) throw error;
  await asUser.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("user_id", userId).is("onboarded_at", null);

  const feed = await scoreUser(serviceClient(), userId);
  return json({ ok: true, feed });
}));
