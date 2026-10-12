import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

const url = () => Deno.env.get("SUPABASE_URL")!;

/** Client acting as the caller: RLS applies. Use for anything done on a user's behalf. */
export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new HttpError(401, "unauthorized");
  return createClient(url(), Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}

/** Service client: bypasses RLS. Only for workers and server-owned writes after authorization. */
export function serviceClient(): SupabaseClient {
  return createClient(url(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export async function requireUser(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "unauthorized");
  return data.user.id;
}
