# Vachi Job Hunt

Android and iPhone app that helps job seekers apply faster and prepare better: a matched job feed with a sponsor-jobs filter, resume tailoring, an apply flow the user approves, and voice practice interviews.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. It explains the system, the data model, the AI pipeline, security and the scaling path, and lists the decisions with their tradeoffs.

## Repository

```
apps/mobile/         Expo (SDK 57) app, Expo Router, TypeScript
packages/core/       Shared, runtime-agnostic logic: schemas, match scoring, job board adapters
supabase/migrations/ Postgres schema with RLS (one file per change, forward-only)
supabase/functions/  Deno Edge Functions: parse-resume, update-preferences, ingest-jobs, score-matches, delete-account
supabase/tests/      Database checks (migrations, RLS, invariants) that run without Docker
```

## What works today (weeks 1 and 2)

- Email code sign-in, with the session stored in the device keychain.
- Onboarding: target roles, locations, work style, minimum salary, sponsorship need.
- Resume upload (PDF or Word) to private storage, server-side text extraction and AI parsing into a structured resume, with embeddings.
- Job ingestion from public Greenhouse, Lever and Ashby boards on a schedule, with normalization (titles, locations, salary, sponsorship statements), change detection and embeddings.
- Feed with an explainable 0 to 100 match score, "why it matches", skills you have and are missing, save and dismiss, and a "sponsor jobs only" toggle (the DOL LCA import that feeds it lands in weeks 7 and 8; the schema is in place).
- Account deletion.

Schemas for the pipeline (with the approval-before-submit rule enforced in the database), billing quotas and AI usage logging are already in place for weeks 3 to 8.

## Setup

Requirements: Node 22+, the Supabase CLI, Deno 2 (for function checks), and Xcode or Android Studio for device builds.

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env          # set Supabase URL and anon key
cp supabase/functions/.env.example supabase/functions/.env   # set ANTHROPIC_API_KEY, VOYAGE_API_KEY, WORKER_SECRET

# Backend
supabase start            # local stack (Docker)
supabase db reset         # applies migrations and seed.sql
supabase functions serve

# App
npm run mobile            # then press i or a; use a development build for device testing
```

Before applying `20261009001000_queues.sql` to a hosted project, enable the `pgmq`, `pg_cron` and `pg_net` extensions, and add two Vault secrets: `project_url` (your Supabase URL) and `worker_secret` (same value as the `WORKER_SECRET` function secret).

## Checks

```bash
npm run check   # typecheck app and core, unit tests, database checks, Edge Function typecheck
```

CI runs the same steps on every pull request (`.github/workflows/ci.yml`).

## Product rules that the code enforces

- The coach is practice only. There is no hidden, overlay or live-interview assistance.
- The server never submits an application. Marking one submitted requires the user's approval of that exact packet (database trigger in `20261009000800_pipeline.sql`).
- All AI calls run server-side through one gateway that validates output and logs usage and cost.
