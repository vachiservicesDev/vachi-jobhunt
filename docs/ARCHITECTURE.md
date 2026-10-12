# Vachi Job Hunt: Architecture

Status: v1.0, 2026-10-09. Owner: Vachi Services. This document is the source of truth for how the system is built and why. Change it in the same PR as any change that contradicts it.

## 1. What we are building

A mobile app (Android and iPhone) that helps job seekers apply faster and prepare better:

1. **Job feed** with an explainable match score, from public job boards and career pages, with a "sponsor jobs only" filter backed by public DOL LCA disclosure data.
2. **Resume tailoring**: a tailored resume and a short cover note per job, missing keywords, PDF export.
3. **Apply agent**: prepares each application and hands it to the user to approve and submit. A pipeline tracks each job from saved to offer.
4. **Practice coach**: voice mock interviews generated from the job description, with feedback afterwards.

Monetization: free tier (3 tailored resumes and 2 practice sessions a month), paid tier ($19 to $29 a month) through RevenueCat.

### Product invariants (enforced in architecture, not just policy)

These are decided and are not negotiable by any feature flag, prompt or config:

| Invariant | How the architecture enforces it |
|---|---|
| No hidden or screen-share-invisible help during live interviews. | The coach only exists as a foreground, in-app practice session against a generated job description. There is no overlay, no background audio capture, no "stealth" window flag, no real-time answer streaming to a second device. The coach API only accepts audio tied to a `practice_session` row that the server created, and returns feedback after each answer turn, never live suggestions mid-answer. |
| No automatic mass-applying without the user's approval. | The server never submits an application. `apply-prepare` produces a packet; only a signed-in user action on the device transitions an application to `submitted`, and that transition requires an `approval` record (who, when, which packet hash). There is no batch-submit endpoint and there is a per-user rate limit on approvals. |
| All AI calls run server-side. | The app holds no model keys. Every model call goes through the AI gateway (section 6), which meters, enforces quotas and logs usage. |

## 2. Goals and non-goals for the 5 to 10 year horizon

**Goals**

- Start on a stack a small team can ship in 8 weeks (Expo, Supabase, RevenueCat) without painting ourselves into a corner.
- Every component has a known "next step" when it outgrows its current home (section 11), and the code is organized so that step is a move, not a rewrite.
- Swap AI providers, speech providers, job sources and payment providers without touching the app.
- Treat resumes and interview audio as sensitive personal data from day one (section 10).

**Non-goals for v1**

- Web app (the architecture supports it later: the same API and the `core` package run on web).
- Recruiter or employer side.
- Our own crawler for arbitrary sites (we use public, sanctioned feeds; section 7).

## 3. System context

```
                ┌──────────────────────────────────────────────────────────┐
                │                    Mobile app (Expo)                     │
                │  Expo Router · TanStack Query · Supabase JS · RevenueCat │
                └───────┬────────────────────┬─────────────────┬───────────┘
                        │ HTTPS (JWT)        │ Storage (signed)│ IAP
                        ▼                    ▼                 ▼
┌───────────────────────────────────────────────────┐   ┌──────────────┐
│                     Supabase                      │   │  App Store / │
│ ┌──────────┐ ┌───────────────┐ ┌───────────────┐  │   │  Play Store  │
│ │   Auth   │ │ Postgres + RLS│ │    Storage    │  │   └──────┬───────┘
│ └──────────┘ │ pgvector      │ │ resumes (priv)│  │          │
│              │ pgmq, pg_cron │ │ audio (priv)  │  │   ┌──────▼───────┐
│              │ pg_trgm       │ │ exports (priv)│  │   │  RevenueCat  │
│              └──────▲────────┘ └───────────────┘  │   └──────┬───────┘
│                     │                             │          │ webhook
│ ┌───────────────────┴───────────────────────────┐ │          │
│ │            Edge Functions (Deno)              │◄┼──────────┘
│ │ api-v1 (BFF) · parse-resume · ingest-jobs ·   │ │
│ │ score-matches · rc-webhook · lca-import       │ │
│ │            └── AI gateway (_shared/ai) ───────┼─┼──► LLM provider(s)
│ └───────────────────────────────────────────────┘ │──► Embeddings
└───────────────────────────────────────────────────┘──► Speech-to-text
                        ▲
                        │ scheduled pulls (pg_cron → pgmq → workers)
        ┌───────────────┴───────────────────┐
        │ Public job APIs (Greenhouse, Lever,│
        │ Ashby, USAJOBS) · DOL LCA files    │
        └────────────────────────────────────┘
```

## 4. Service boundaries

We run a **modular monolith on Supabase** with hard internal boundaries. Each module owns its tables (by schema) and exposes functions; no module reads another module's tables directly except through views or RPCs it publishes. This keeps the "split into services later" option real.

| Module | Owns (Postgres schema) | Responsibilities | Runs in |
|---|---|---|---|
| **identity** | `public.profiles`, `public.preferences` | Profile, target roles, locations, salary, sponsorship need, consent, account deletion | Postgres + RLS, `api-v1` |
| **resume** | `public.resumes`, `public.resume_versions` | Upload, parse to structured JSON, versioning, tailoring outputs, PDF export | `parse-resume`, `api-v1`, later `tailor-resume` |
| **jobs** | `jobs.*` | Source adapters, ingestion, normalization, dedupe, embeddings, company entities | `ingest-jobs` worker |
| **matching** | `public.job_matches` | Hard filters, scoring, explanations, feed ranking | `score-matches` worker, SQL RPC `get_feed` |
| **sponsor** | `sponsor.*` | DOL LCA import, employer name resolution, sponsor stats | `lca-import` worker |
| **pipeline** | `public.applications`, `public.application_events`, `public.approvals` | Apply packets, approval, status tracking | `api-v1` (weeks 3 to 6) |
| **coach** | `public.practice_sessions`, `public.practice_turns` | Question generation, STT, feedback | `coach-*` functions (weeks 5 and 6) |
| **billing** | `billing.*` | Entitlements from RevenueCat, usage counters, quotas | `rc-webhook`, `_shared/quota` |
| **ai** | `ai.*` | Prompt registry, model routing, usage and cost logs, evals | `_shared/ai` (library, not a service yet) |

**Client access rule:** the app reads its own rows directly through PostgREST under RLS (cheap, fast, offline-friendly) and calls Edge Functions for anything that costs money, touches third parties, or writes derived data. The app never writes to `jobs`, `sponsor`, `billing`, `ai` or `job_matches`.

## 5. Data model

All tables have `id uuid default gen_random_uuid()`, `created_at`, `updated_at`. All user-owned tables carry `user_id` and an RLS policy `user_id = auth.uid()`. Full DDL is in `supabase/migrations/`.

```
auth.users 1─1 profiles 1─1 preferences
     │
     ├─< resumes ─< resume_versions (parsed JSON, schema_version, source = upload|tailored)
     │
     ├─< job_matches >─ jobs.postings >─ jobs.companies ─< sponsor.employer_stats
     │                        │                 ▲
     │                        └─ jobs.sources   └── sponsor.employer_aliases (trgm)
     │
     ├─< applications ─< application_events
     │        └─< approvals (packet_hash, approved_at, device)
     │
     ├─< practice_sessions ─< practice_turns (audio_path, transcript, feedback)
     │
     └─ billing.entitlements · billing.usage_counters (user, feature, period)
```

Key design choices:

- **Resume content is JSON with a `schema_version`** (`ResumeDocument` in `packages/core`). Parsers and tailoring produce the same shape, so rendering and diffing are uniform, and we can migrate old documents lazily when the schema version bumps.
- **Jobs are global, matches are per user.** `jobs.postings` is shared across users; `job_matches(user_id, posting_id, score, reasons jsonb, scored_at, model_version)` is the per-user projection. This is what lets us scale feeds without per-user crawling.
- **Postings are append-mostly with a content hash.** `(source_id, external_id)` is unique; `content_hash` decides whether to re-embed. Closed postings get `closed_at`, never deleted (pipeline rows reference them).
- **Embeddings live next to the row** (`vector(1024)` with HNSW index) and record `embedding_model`. 1024 dimensions is supported by both Voyage (`voyage-3.5`, the default) and OpenAI (`text-embedding-3-*` with `dimensions`), so the provider can change without a schema change. Changing the model is a backfill job, not a migration of logic.
- **Partitioning ready:** `jobs.postings` is keyed so it can become a list partition on `status` or range partition on `posted_at` once it passes ~20M rows. `application_events` and `ai.usage_log` are range-partitioned by month from day one because they only grow.
- **Money and quotas** are counted server-side in `billing.usage_counters` with a unique `(user_id, feature, period_start)` and incremented in the same transaction that records the work, so quotas cannot be bypassed by the client.

## 6. AI pipeline

All model access goes through `supabase/functions/_shared/ai/`, a small gateway library with four parts:

1. **Prompt registry.** Each task (`resume.parse`, `resume.tailor`, `cover.note`, `keywords.missing`, `coach.questions`, `coach.feedback`) has a versioned prompt file and a Zod output schema in `packages/core`. Outputs are validated; on validation failure we retry once with the error, then fail closed.
2. **Model router.** Maps a task to a model through config (`AI_MODEL_<TASK>` function secrets). Every task defaults to `claude-opus-5-5`, with `effort` set per task (`low` for extraction, higher for tailoring and feedback). Moving a high-volume task such as `resume.parse` to `claude-haiku-5-5` is a one-line config change once evals confirm quality holds. Structured output uses the API's JSON schema output format (`output_config.format`), validated again with Zod. Embeddings and speech-to-text sit behind the same module.
3. **Guardrails.** Job descriptions and resumes are untrusted text. They are passed as clearly delimited data, never concatenated into instructions; outputs are schema-validated; tailoring is constrained to facts present in the source resume (the "no fabrication" rule: the tailor prompt receives the parsed resume and must cite the source bullet for every rewritten bullet, and we reject outputs that introduce employers, titles, dates or degrees not in the source).
4. **Metering.** Every call writes `ai.usage_log(user_id, task, model, input_tokens, output_tokens, cost_usd, latency_ms, prompt_version, ok)`. That gives unit economics per feature, which the paid-tier price depends on.

Flow per feature:

| Feature | Trigger | Steps |
|---|---|---|
| Resume parse | Upload completes | Storage upload → `parse-resume` → extract text (PDF/DOCX) → LLM structured extraction → validate `ResumeDocument` → save `resume_versions` → embed summary+skills → enqueue `score-matches` for this user |
| Match scoring | New resume, new prefs, or new postings | Hard filters in SQL → vector top-K (cosine) → deterministic score in `packages/core/match` → store top N with reasons. No LLM in the hot path; LLM only for an optional "why this fits" explanation on tap. |
| Tailoring (wk 3) | User taps Tailor | Quota check → LLM tailor with source citations → fabrication check → missing keywords → render PDF server-side → store in `exports` bucket → increment usage |
| Coach (wk 5) | User starts practice | Generate questions from JD → per turn: client records → upload → STT → feedback LLM after the turn → session summary |

Cost controls: cache by `(task, prompt_version, input_hash)`; batch embeddings in ingestion; tune `effort` and the per-task model from measured `ai.usage_log` cost and eval quality; hard per-user monthly ceilings independent of plan (`parse` is metered too, to stop abuse).

## 7. Job ingestion

**Sources (v1), all public and intended for programmatic access:**

| Source | Endpoint pattern | Notes |
|---|---|---|
| Greenhouse Job Board API | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Per company board token |
| Lever Postings API | `api.lever.co/v0/postings/{company}?mode=json` | Per company |
| Ashby Job Board API | `api.ashbyhq.com/posting-api/job-board/{org}` | Per company |
| USAJOBS | `data.usajobs.gov/api/search` | Needs API key, federal jobs |

We do not scrape LinkedIn, Indeed or sites whose terms forbid it. Each company we track is a row in `jobs.sources(kind, token, company_id, enabled, poll_interval, last_success_at, etag)`. The seed list comes from employers that appear in LCA data (so the sponsor filter has coverage) plus a curated list.

**Pipeline:**

```
pg_cron (every 15 min) → enqueue due sources into pgmq 'ingest'
ingest-jobs worker (batch of N sources):
  fetch (with ETag/If-Modified-Since, per-host rate limit, timeout)
  → adapter.normalize() → NormalizedPosting (packages/core)
  → upsert jobs.postings ON CONFLICT (source_id, external_id)
  → mark missing postings closed
  → for changed content_hash: enqueue 'embed'
embed worker: batch embeddings → update postings.embedding
  → enqueue 'score' for users whose prefs match (by role family and location)
```

Adapters are pure functions (`raw → NormalizedPosting[]`) in `packages/core/src/ingest/` so they are unit-tested without network and can move to any runtime. Normalization covers title cleanup, role family classification, location parsing (city, region, country, remote type), salary parsing to annual USD ranges, and employment type.

**Dedupe:** the same job often appears on several boards. We compute `dedupe_key = hash(company_id, normalized_title, primary_location)` and show one canonical posting with alternate apply links.

## 8. Sponsor data (DOL LCA)

The US Department of Labor Office of Foreign Labor Certification publishes quarterly LCA disclosure files (H-1B, H-1B1, E-3) as spreadsheets. We use them to answer "does this employer sponsor, how often, for which roles, at what wages".

**Import (`lca-import`, quarterly, manual trigger at first):**

1. Download the fiscal-year quarter file, stream-parse rows (files are large; never load fully in memory).
2. Keep certified cases only. Store a slim fact table `sponsor.lca_cases(case_number, fiscal_year, employer_name_raw, employer_fein_hash, soc_code, job_title, worksite_city, worksite_state, wage_from, wage_unit, decision_date, status)`.
3. Aggregate to `sponsor.employer_stats(company_id, fiscal_year, certified_count, top_soc_codes, median_wage, last_filed_at)`.

**Employer resolution** is the hard part. LCA employer names ("GOOGLE LLC", "Google, L.L.C.") must map to our `jobs.companies`. We normalize names (case, punctuation, legal suffixes) in `packages/core/src/sponsor/normalize.ts`, match exact first, then `pg_trgm` similarity above a threshold, and keep a manual `sponsor.employer_aliases` override table. Unresolved high-volume employers go to a review queue.

**Product semantics, stated carefully in the UI:** "Filed N H-1B LCAs in FY2026" is a fact; "will sponsor you" is not. The filter is "employers with recent certified LCAs for similar roles", and postings that explicitly say "no sponsorship" are excluded via a text classifier on the JD. We show the data source and date. This avoids promising visa outcomes.

## 9. Mobile app architecture

- **Expo SDK 57, Expo Router (file-based), TypeScript strict.** Development builds (not Expo Go) once we add RevenueCat and audio.
- **State:** server state in TanStack Query (cache, retries, offline persistence); local UI state in React state; no global store until needed.
- **Data access** goes through `apps/mobile/src/lib/api.ts`, which wraps Supabase queries and function calls with types from `packages/core`. Screens never call `supabase.from()` directly. This is the seam that lets us replace PostgREST with a dedicated API later without touching screens.
- **Auth:** Supabase Auth with email OTP, Sign in with Apple (required by App Store when other social login exists), Google. Session in `expo-secure-store`.
- **Versioned API and forced upgrade:** every function call sends `x-app-version`; the server returns `426` below `min_supported_version` (from a config table), and the app shows an update screen. In five years there will be old binaries in the wild; this is how we keep changing the backend.
- **Feature flags and remote config** from a `public.app_config` table (read-only via RLS) at first, so paywall copy, quotas and experiments change without releases.
- **OTA updates** with EAS Update for JS-only fixes, with runtime version policy tied to native fingerprint.

## 10. Security and privacy

Resumes contain name, contact info, work history and sometimes immigration status; interview audio is voice biometric-adjacent. We treat both as sensitive.

- **RLS on every table**, default deny. CI runs a check that fails if any table in `public` lacks RLS (see `supabase/tests/rls.sql`).
- **Storage:** private buckets `resumes`, `audio`, `exports`, path prefix `{user_id}/...`, storage policies match `auth.uid()`. Downloads only through short-lived signed URLs.
- **Secrets** (LLM keys, STT keys, RevenueCat webhook secret, USAJOBS key) live only in Edge Function secrets. The app bundle contains only the Supabase anon key and RevenueCat public SDK keys.
- **Service role key** is used only inside workers, never in `api-v1` request paths that act for a user; user-facing functions create a client with the caller's JWT so RLS still applies.
- **Webhooks** (RevenueCat) are verified by shared secret header and are idempotent on event id.
- **Sponsorship need is sensitive.** It is stored in `preferences`, never sent to third parties, never used in analytics events, and excluded from AI prompts except where the user asks for sponsor-related help.
- **Data minimization in AI calls:** contact details are stripped from resume text before sending to model providers; we use providers with zero data retention terms for API traffic where available.
- **Retention and deletion:** account deletion (required by both stores) is a single RPC that deletes storage objects and cascades rows; audio is deleted 30 days after a practice session unless the user saves it; `ai.usage_log` keeps no content, only counts.
- **Abuse limits:** per-user and per-IP rate limits on functions; approval rate limit on the apply flow; signed upload size limits (resume 10 MB, audio 25 MB per turn).
- **Compliance posture:** GDPR and CCPA data export and deletion endpoints; privacy labels for both stores; SOC 2-friendly audit log of admin actions (`audit.events`).

## 11. Scaling path

Numbers are planning estimates, not measurements. We move to the next stage when a metric, not a calendar, says so.

| Stage | Users (MAU) | Shape | Trigger to move on |
|---|---|---|---|
| **0. Launch** | 0 to 50k | Everything on Supabase (Pro). Workers are Edge Functions driven by pg_cron and pgmq (through service-role-only `queue_*` wrappers). | Function timeouts on ingestion, or DB CPU > 60% sustained |
| **1. Workers out** | 50k to 300k | Move `ingest`, `embed`, `score`, `lca-import`, PDF rendering to a container worker (Cloud Run or Fly) consuming the same pgmq queues. Add a read replica for feed reads. Connection pooling via Supavisor in transaction mode. | Feed p95 > 400 ms, or vector search dominates DB load |
| **2. Search out** | 300k to 2M | Move posting search and vector retrieval to a dedicated engine (OpenSearch, Typesense or a managed vector DB) fed by CDC from Postgres. Postgres remains the system of record. Partition `postings`. | Write contention, or a second product (web, employer side) needs its own API |
| **3. Services** | 2M+ | Split along the module boundaries in section 4 (they already own their schemas). Event bus (Kafka or Pub/Sub) replaces pgmq for cross-module events. Multi-region read paths. | Org size and blast radius, not traffic alone |

Why this works over 5 to 10 years: the seams already exist (module-owned schemas, queue-driven workers, a typed API layer in the app, provider-agnostic AI gateway, pure-function adapters and scoring in `packages/core`). Each stage moves code, it does not rewrite it.

## 12. Key decisions and tradeoffs

| # | Decision | Alternatives considered | Why | Cost we accept |
|---|---|---|---|---|
| D1 | Supabase as backend | Firebase; custom Node API on AWS | Postgres (relational data, pgvector, RLS, SQL analytics) with auth, storage and functions in one; no lock-in at the data layer | Edge Function limits (time, memory) push heavy work to workers by stage 1 |
| D2 | Modular monolith with schema-per-module | Microservices from day one | 8-week MVP and a small team; boundaries enforced by schema ownership keep a split cheap later | Discipline needed; reviewed in PRs |
| D3 | Pure-TS `packages/core` shared by app and functions | Duplicate logic per runtime | Scoring, normalization and schemas tested once, identical on device and server | Must stay dependency-light (only `zod`) and runtime-agnostic |
| D4 | Deterministic match score with vector recall | LLM ranks every job | Explainable, cheap, fast, testable; LLM explains on demand only | Less "magical" ranking at first; tune weights with data |
| D5 | pgmq + pg_cron for jobs | SQS, Inngest, Temporal | Zero new infra, transactional enqueue with the data change | Move to a dedicated queue at stage 3 |
| D6 | Public ATS APIs only | Scraping aggregators | Legal and stable; aligns with store review and long-term trust | Coverage limited to companies on those ATSs; expand via partnerships |
| D7 | Server never submits applications | Headless browser auto-submit | Product invariant; also avoids ATS bot bans and account risk for users | Users do the final tap on each application |
| D8 | Resume as versioned JSON, PDF rendered server-side | Store DOCX/PDF only | Diffable, tailorable, re-renderable with new templates | Must render well; template work in weeks 3 and 4 |
| D9 | RevenueCat entitlements mirrored into Postgres | Check RevenueCat from the client only | Server-side quota enforcement for AI costs | Webhook lag of seconds; app also reads RC SDK for instant UI |
| D10 | Provider-agnostic AI gateway | Call one vendor SDK directly | Prices and quality change yearly; swap per task via config | Thin abstraction to maintain |

## 13. Observability and quality

- Structured JSON logs from functions with `request_id`, `user_id` (hashed), `task`, `latency_ms`.
- Sentry for app and functions; PostHog (self-serve, EU or US region) for product analytics with a strict event allowlist (no resume content, no sponsorship field).
- SLOs: feed load p95 < 800 ms; resume parse p95 < 20 s; tailoring p95 < 30 s; crash-free sessions > 99.5%.
- AI evals: a fixed set of anonymized resumes and JDs per task, run in CI on prompt changes, scoring schema validity, fabrication rate and keyword recall.
- CI: typecheck, unit tests (`packages/core`), SQL tests for RLS, Expo lint; EAS builds on tags.

## 14. Milestones mapped to architecture

| Weeks | Deliverables | Modules |
|---|---|---|
| 1 and 2 | Auth, resume upload and parsing, profile, job feed with match score | identity, resume (parse), jobs (Greenhouse, Lever, Ashby adapters), matching |
| 3 and 4 | Tailoring, PDF export, pipeline tracker | resume (tailor, render), pipeline, billing (usage counters) |
| 5 and 6 | Voice coach, approve-and-submit apply flow | coach, pipeline (approvals) |
| 7 and 8 | Paywall, sponsor filter, store listings, launch | billing (RevenueCat), sponsor |

The week 1 and 2 scaffold in this repo already includes the sponsor and billing schemas so later weeks are additive.

## 15. Repository layout

```
apps/mobile/                 Expo app (Expo Router)
  src/app/                   Routes: (auth), (onboarding), (tabs), job/[id]
  src/lib/                   supabase client, typed api layer, query client
  src/components/            UI primitives
packages/core/               Runtime-agnostic TS: schemas, match scoring, ingest adapters, normalizers
supabase/
  migrations/                SQL, one file per change, forward-only
  functions/                 Deno Edge Functions; _shared/ for ai, clients, http, queue, scoring
  tests/                     PGlite-based migration, RLS and invariant checks (no Docker)
  seed.sql                   Local dev seed (sources)
docs/                        This document, ADRs
```

## 16. Open questions for the owner

1. Which GitHub repository should hold the code (a new `vachi-jobhunt` repo is the default)?
2. Model cost tradeoff: every AI task defaults to Claude Opus 5.5. Moving resume parsing (high volume, simple) to Claude Haiku 5.5 would cut its cost sharply; it is a config change, and the owner's call once evals are in.
3. Speech-to-text provider for the coach (decide by week 5).
4. Exact paid price within $19 to $29 (RevenueCat experiments can test this at launch).
