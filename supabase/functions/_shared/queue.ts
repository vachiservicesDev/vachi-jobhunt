import type { SupabaseClient } from "@supabase/supabase-js";

export interface QueueMessage<T> { msg_id: number; read_ct: number; message: T }

export async function readQueue<T>(db: SupabaseClient, queue: string, visibilitySec: number, qty: number): Promise<QueueMessage<T>[]> {
  const { data, error } = await db.rpc("queue_read", { p_queue: queue, p_vt: visibilitySec, p_qty: qty });
  if (error) throw error;
  return (data ?? []) as QueueMessage<T>[];
}

export async function ack(db: SupabaseClient, queue: string, msgId: number): Promise<void> {
  const { error } = await db.rpc("queue_delete", { p_queue: queue, p_msg_id: msgId });
  if (error) throw error;
}

export async function send(db: SupabaseClient, queue: string, message: unknown): Promise<void> {
  const { error } = await db.rpc("queue_send", { p_queue: queue, p_msg: message });
  if (error) throw error;
}

/** Poison messages are dropped after this many deliveries (and logged by the caller). */
export const MAX_DELIVERIES = 5;
