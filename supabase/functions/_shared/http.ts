export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

/** Compares dotted versions: returns true when `v` is older than `min`. */
export function isOlder(v: string, min: string): boolean {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/**
 * Wraps a handler with CORS, structured errors, request ids and the
 * forced-upgrade gate (ARCHITECTURE.md section 9).
 */
export function handler(fn: (req: Request, ctx: { requestId: string }) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const requestId = crypto.randomUUID();
    const started = Date.now();
    try {
      const appVersion = req.headers.get("x-app-version");
      const min = Deno.env.get("MIN_SUPPORTED_APP_VERSION");
      if (appVersion && min && isOlder(appVersion, min)) {
        throw new HttpError(426, "upgrade_required", "Please update the app to continue.");
      }
      const res = await fn(req, { requestId });
      log({ requestId, path: new URL(req.url).pathname, status: res.status, ms: Date.now() - started });
      return res;
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "internal");
      log({ requestId, path: new URL(req.url).pathname, status: err.status, ms: Date.now() - started, error: String(e) });
      return json({ error: err.code, message: err.status < 500 ? err.message : "Something went wrong.", requestId }, err.status);
    }
  };
}

export function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...fields }));
}

export function requireWorker(req: Request): void {
  const secret = Deno.env.get("WORKER_SECRET");
  if (!secret || req.headers.get("x-worker-secret") !== secret) throw new HttpError(401, "unauthorized");
}
