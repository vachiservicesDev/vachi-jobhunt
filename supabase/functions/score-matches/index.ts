// Worker: drains the 'score' queue, coalescing duplicate user ids, and recomputes feeds.
import { serviceClient } from "../_shared/clients.ts";
import { handler, json, log, requireWorker } from "../_shared/http.ts";
import { ack, readQueue } from "../_shared/queue.ts";
import { scoreUser } from "../_shared/scoring.ts";

const TIME_BUDGET_MS = 110_000;

Deno.serve(handler(async (req) => {
  requireWorker(req);
  const db = serviceClient();
  const started = Date.now();
  let users = 0;
  while (Date.now() - started < TIME_BUDGET_MS) {
    const msgs = await readQueue<{ user_id: string }>(db, "score", 120, 50);
    if (msgs.length === 0) break;
    const byUser = new Map<string, number[]>();
    for (const m of msgs) byUser.set(m.message.user_id, [...(byUser.get(m.message.user_id) ?? []), m.msg_id]);
    for (const [userId, ids] of byUser) {
      try {
        await scoreUser(db, userId);
        users++;
      } catch (e) {
        log({ msg: "score failed", userId, error: String(e) });
        continue; // message becomes visible again after the visibility timeout
      }
      for (const id of ids) await ack(db, "score", id);
    }
  }
  return json({ users });
}));
