// POST — deletes the caller's files and account (App Store and Play requirement).
import { requireUser, serviceClient, userClient } from "../_shared/clients.ts";
import { handler, json } from "../_shared/http.ts";

const BUCKETS = ["resumes", "exports", "audio"];

Deno.serve(handler(async (req) => {
  const asUser = userClient(req);
  const userId = await requireUser(asUser);
  const db = serviceClient();

  for (const bucket of BUCKETS) {
    // Objects live under {user_id}/...; list and remove in pages.
    for (;;) {
      const { data, error } = await db.storage.from(bucket).list(userId, { limit: 1000 });
      if (error) throw error;
      if (!data?.length) break;
      const { error: rmErr } = await db.storage.from(bucket).remove(data.map((o) => `${userId}/${o.name}`));
      if (rmErr) throw rmErr;
      if (data.length < 1000) break;
    }
  }
  const { error } = await asUser.rpc("delete_my_account");
  if (error) throw error;
  return json({ ok: true });
}));
