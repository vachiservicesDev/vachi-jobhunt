import Constants from "expo-constants";
import type { Preferences, ResumeDocument } from "@vachi/core";
import { supabase } from "./supabase";

/**
 * The only module screens use for data (ARCHITECTURE.md section 9). Keeping
 * Supabase calls here lets us move to a dedicated API later without touching UI.
 */
const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body, headers: { "x-app-version": APP_VERSION } });
  if (error) {
    // FunctionsHttpError carries the response; surface our structured error message.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = (await ctx.json().catch(() => null)) as { error?: string; message?: string } | null;
      throw new ApiError(payload?.error ?? "error", payload?.message ?? "Something went wrong.", ctx.status);
    }
    throw new ApiError("network", "Check your connection and try again.");
  }
  return data as T;
}

export interface FeedItem {
  posting_id: string;
  score: number;
  reasons: string[];
  matched_skills: string[];
  missing_skills: string[];
  title: string;
  company_name: string;
  company_logo: string | null;
  locations: Array<{ raw: string; city?: string; region?: string; remote: string }>;
  salary_min_usd: number | null;
  salary_max_usd: number | null;
  posted_at: string | null;
  apply_url: string;
  sponsorship_statement: "offers" | "denies" | "unknown";
  sponsor_filings: number | null;
  saved: boolean;
}

export interface ResumeRow {
  id: string;
  label: string;
  parse_status: "pending" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  is_primary: boolean;
  created_at: string;
}

export const api = {
  async getProfile() {
    const { data, error } = await supabase.from("profiles").select("onboarded_at, display_name").maybeSingle();
    if (error) throw error;
    return data;
  },

  async getPreferences(): Promise<Preferences | null> {
    const { data, error } = await supabase.from("preferences").select("*").maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      targetRoles: data.target_roles,
      locations: data.locations,
      remote: data.remote,
      salaryMinUsd: data.salary_min_usd,
      needsSponsorship: data.needs_sponsorship,
      seniority: data.seniority ?? undefined,
    };
  },

  savePreferences: (p: Preferences) => call<{ ok: true; feed: { kept: number } }>("update-preferences", { ...p }),

  async listResumes(): Promise<ResumeRow[]> {
    const { data, error } = await supabase.from("resumes").select("id, label, parse_status, parse_error, is_primary, created_at").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** Uploads to private storage, records the row, then asks the server to parse it. */
  async uploadResume(file: { uri: string; name: string; mimeType: string; size: number }) {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) throw new ApiError("unauthorized", "Please sign in again.");
    const ext = file.mimeType === "application/pdf" ? "pdf" : "docx";
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${userId}/${id}.${ext}`;
    const bytes = await (await fetch(file.uri)).arrayBuffer();
    const up = await supabase.storage.from("resumes").upload(path, bytes, { contentType: file.mimeType, upsert: false });
    if (up.error) throw new ApiError("upload_failed", "Upload failed. Try again.");
    const { data: row, error } = await supabase.from("resumes")
      .insert({ user_id: userId, label: file.name.replace(/\.(pdf|docx)$/i, ""), storage_path: path, mime_type: file.mimeType, size_bytes: file.size })
      .select("id").single();
    if (error) throw error;
    return call<{ resume_id: string; document: ResumeDocument; feed: { kept: number } }>("parse-resume", { resume_id: row.id });
  },

  async getFeed(opts: { sponsorOnly: boolean; after?: { score: number; posting_id: string } }): Promise<FeedItem[]> {
    const { data, error } = await supabase.rpc("get_feed", {
      p_sponsor_only: opts.sponsorOnly,
      p_limit: 25,
      p_after_score: opts.after?.score ?? null,
      p_after_posting: opts.after?.posting_id ?? null,
    });
    if (error) throw error;
    return (data ?? []) as FeedItem[];
  },

  async setSaved(postingId: string, saved: boolean) {
    const { error } = await supabase.from("job_matches").update({ saved_at: saved ? new Date().toISOString() : null }).eq("posting_id", postingId);
    if (error) throw error;
  },

  async dismiss(postingId: string) {
    const { error } = await supabase.from("job_matches").update({ dismissed_at: new Date().toISOString() }).eq("posting_id", postingId);
    if (error) throw error;
  },

  deleteAccount: () => call<{ ok: true }>("delete-account", {}),
};
