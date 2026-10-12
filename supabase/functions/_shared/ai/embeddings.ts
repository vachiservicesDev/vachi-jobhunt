/**
 * Embeddings provider. Voyage by default; the dimension (1024) is fixed by the
 * schema, and the model name is stored next to every vector so a model change
 * becomes a backfill job (ARCHITECTURE.md section 5).
 */
export const EMBEDDING_DIM = 1024;
export const EMBEDDING_MODEL = Deno.env.get("EMBEDDING_MODEL") ?? "voyage-3.5";

export async function embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128).map((t) => t.slice(0, 24_000));
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("VOYAGE_API_KEY")}` },
      body: JSON.stringify({ input: batch, model: EMBEDDING_MODEL, input_type: kind, output_dimension: EMBEDDING_DIM }),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    for (const d of body.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
  }
  return out;
}

/** pgvector literal for inserts through PostgREST. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
