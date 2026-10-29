# Hand-off: Vachi Group staffing blueprint for Job Hunt

Status: proposal, 2026-10-29. From the Idea Manager project. Full doc with diagrams: [Vachi Job Hunt: Blueprint and Requirements](https://claude.ai/artifact/PH5i2WYeXq7Vxjw9F6hgfP).

Ravi's goal, in his words: candidates should apply to many jobs with no effort, the AI should apply to every job that matches them, and the company goal is getting people hired in the shortest time. This file lists what that adds to `docs/ARCHITECTURE.md`, and where the two disagree. Nothing here overrides ARCHITECTURE.md until the owner decides the items in "Decisions for Ravi".

## What this adds

Vachi Services places candidates (many on OPT, STEM OPT and H1B) with clients and vendor partners. The blueprint adds a staffing side to the job-seeker app, so the fastest paths to a hire are covered:

| Lane | Job source | How the application goes in | Speed to hire |
| --- | --- | --- | --- |
| 1. Our clients | Vachi job posts (`website_jobs` in the website/portal Supabase project) and client job orders | AI shortlists, recruiter approves, profile goes to the client the same day | Days |
| 2. Vendor partners | Requirement emails from vendors and prime contractors | AI finds the top 5 candidates and drafts the submission email; recruiter sends | 1 to 2 weeks |
| 3. Career sites | Greenhouse, Lever, Ashby (already built) plus feeds such as Adzuna, JSearch, USAJobs | Tailored packet; candidate approves | 2 to 4 weeks |
| 4. LinkedIn and Indeed | Links found through feeds | No bot. Candidate taps Easy Apply with the tailored resume | Medium |

New requirements beyond weeks 1 to 8:

- **Recruiter role and board**: every candidate's matches, submissions, interviews and offers by stage; recruiters see only assigned candidates, admins see all.
- **Vendor requirement inbox**: paste or forward a requirement; AI returns the top 5 candidates with reasons and a drafted submission email.
- **Client job orders**: import Vachi's own job posts as a high-priority source.
- **Auto-apply rules per candidate**: for example, score 80+ apply, 60 to 79 ask me, daily cap. See the conflict below.
- **Placement metrics**: time to first interview, interviews per 10 applications, time to placement, per recruiter and per candidate.
- **Success test**: 10 real candidates, each with 2+ interviews within 30 days, time to first interview under 7 days.

Revenue for this side comes from client billing margin and direct-hire fees. H1B workers must not be charged recruitment or placement fees; confirm with an immigration attorney before any candidate-paid plan is offered to people on Vachi's payroll.

## Where it conflicts with ARCHITECTURE.md

| Topic | ARCHITECTURE.md today | Blueprint asks for |
| --- | --- | --- |
| Submitting applications | Invariant: the server never submits; every submit needs the user's approval of that exact packet (D7) | Auto-apply above a score threshold the candidate set up in advance |
| Recruiter side | Non-goal for v1 | Core for lanes 1 and 2 |
| Database | Its own Supabase project (`vachi-jobhunt`) | Share logins and job posts with the Vachi website/portal project, so staff and candidates use one portal |
| Pricing | $19 to $29 / month consumer plan | Placement revenue first; consumer plan optional |

Suggested middle path for the first conflict: keep the invariant and add a "standing approval" that the candidate signs once per rule (score threshold, daily cap, lanes 1 to 3 only). The server still never submits on its own judgment, every application keeps an approval record, and LinkedIn and Indeed stay manual.

## Decisions for Ravi

1. Keep "server never submits", or allow standing approvals as above?
2. Add the recruiter side now, or after the consumer app ships?
3. Connect to the website/portal Supabase project, or keep Job Hunt's own database and sync job posts?
4. First candidate group: OPT/STEM OPT, H1B, or all?
5. First job types: IT/software, healthcare, finance, manufacturing?
