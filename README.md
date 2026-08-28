# Policy Prism

A policy coverage assessment tool for hospitals. It takes your policy documents and a library of regulatory requirements, works out which requirements actually apply to your facility, matches each one against your policy set, and tells you where the coverage is thin — with evidence, a suggested owner, draft policy language, and a human review step before anything counts as a finding.

**Policy Prism assesses coverage, it does not certify compliance.** Every finding requires human review, and every export carries that statement.

---

## What it does

- **Facility profile** decides scope. Bed count, state, Medicare certification, accreditation and service lines determine which requirements apply. Change the profile and the requirement set changes with it — the app marks that break in the run history rather than quietly comparing incomparable numbers.
- **Two libraries.** Policies (your documents) and Regulations (CMS, HIPAA, EMTALA, CLIA, state, Joint Commission, custom). Both support full CRUD, file upload (`.txt .md .csv .tsv .json .docx`) and, for policies, version history.
- **Analysis** scores every applicable requirement against every regulatory-scope policy using IDF-weighted term recall with a negation-aware tokenizer, then classifies each as *Covered*, *Partial*, *Not addressed* or *No policy*.
- **Flags** surface things a raw score hides: contradictions (the policy uses the requirement's vocabulary inside a negation), overdue-for-review documents, joint coverage across several policies, borderline scores, and unprovable requirements.
- **Gaps** turn findings into work: priority, suggested owner, effort, risk if unresolved, the specific provisions the policy set is silent on, a six-step closure plan, and generated draft policy language.
- **Review queue** is the gate. Findings are candidates until a reviewer approves or rejects them. Rejections require a comment. When a policy or requirement changes and the conclusion flips, prior decisions are carried forward but flagged for re-review.
- **Remediation** tracks owned work with due dates derived from priority.
- **Reports** export as PDF, Excel or CSV — every row read from Postgres at request time.
- **Audit trail** is append-only and sequence-numbered per facility, so a missing number is visible.

---

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL with Drizzle ORM and Drizzle migrations |
| Auth | JWT (`jsonwebtoken`) with bcrypt password hashing and role-based permissions |
| Validation | Zod on every request body, query and param |
| Uploads | Multer with an extension and MIME allowlist |
| Reports | PDFKit, ExcelJS, native CSV |

The repo is an npm workspace with three packages: `shared` (domain vocabulary and DTOs used by both sides), `server`, and `client`.

```
policy-prism/
├── shared/src/index.ts        Coverage classes, thresholds, roles, DTOs
├── server/
│   ├── drizzle/               SQL migrations
│   └── src/
│       ├── config/env.ts      Zod-validated environment
│       ├── db/                Schema, connection, seed, migrate, reset
│       ├── services/          engine, remediation, scope, ingest, audit, export
│       ├── middleware/        auth, validation, error handling, upload
│       ├── modules/           auth, hospitals, policies, regulations,
│       │                      analysis, gaps, reviews, remediation,
│       │                      reports, audit
│       ├── app.ts
│       └── server.ts
└── client/src/
    ├── api/client.ts          Typed fetch wrapper with token handling
    ├── components/            AppShell, shared UI primitives
    ├── hooks/                 useAuth, useToast
    └── pages/                 One per view
```

---

## Running it locally

**Prerequisites:** Node.js 20 or newer, and PostgreSQL 14 or newer running locally (or a free Neon/Supabase database).

### 1. Install

```bash
cd policy-prism
npm install
```

### 2. Create the database

```bash
createdb policy_prism
```

If `createdb` is not on your path:

```bash
psql -U postgres -c "CREATE DATABASE policy_prism;"
```

Using Docker instead:

```bash
docker run --name policy-prism-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=policy_prism -p 5432:5432 -d postgres:16
```

### 3. Configure the environment

```bash
cp .env.example server/.env
```

Open `server/.env` and set `DATABASE_URL` to your connection string, then replace `JWT_SECRET` with a real random value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 4. Migrate and seed

```bash
npm run db:migrate
npm run db:seed
```

The seed loads Riverbend Regional Medical Center (a 312-bed Ohio acute care hospital), 28 regulatory requirements across six frameworks, 17 policies, and the four demo accounts.

### 5. Start both apps

```bash
npm run dev
```

- Frontend: **http://localhost:5173**
- API: **http://localhost:4000** (`/health` for status, `/api` for the route index)

Vite proxies `/api` to the backend in development, so no frontend environment variable is needed locally.

To run them separately:

```bash
npm run dev:server
npm run dev:client
```

---

## Demo accounts

All four use the password **`PolicyPrism!2026`**.

| Email | Role | Can |
| --- | --- | --- |
| `admin@policyprism.demo` | Compliance manager | edit, review, profile, run, export |
| `reviewer@policyprism.demo` | Compliance reviewer | review, run, export |
| `analyst@policyprism.demo` | Policy analyst | edit, profile, run, export |
| `auditor@policyprism.demo` | Auditor (read only) | export |

The sign-in page lists them; click any one to fill the form. Permissions are enforced on the server, not just hidden in the UI — a viewer calling `POST /api/policies` gets a 403 with an explanation of which role is required.

To change the seeded password, set `SEED_PASSWORD` in `server/.env` before running `npm run db:seed`.

---

## Useful commands

Run from the repository root:

| Command | Effect |
| --- | --- |
| `npm run dev` | Start API and frontend together |
| `npm run build` | Type-check and build all three packages |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Load the demo facility, libraries and users |
| `npm run db:reset` | Drop every table, re-migrate, re-seed |
| `npm run db:generate` | Generate a new migration after editing `schema.ts` |
| `npm run db:push` | Push the schema directly (development shortcut) |
| `npm run setup` | Migrate and seed in one step |

---

## API

Every response uses the same envelope:

```json
{ "success": true, "data": {}, "meta": {} }
{ "success": false, "error": { "message": "...", "code": "..." } }
```

Authenticate with `Authorization: Bearer <token>` from `POST /api/auth/login`.

| Area | Routes |
| --- | --- |
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout` · `GET /api/auth/users` |
| Facility | `GET|PATCH /api/hospital/profile` |
| Policies | `GET|POST /api/policies` · `GET|PATCH|DELETE /api/policies/:id` · `POST /api/policies/upload` · `GET /api/policies/:id/versions` |
| Regulations | `GET|POST /api/regulations` · `GET|PATCH|DELETE /api/regulations/:id` · `POST /api/regulations/upload` |
| Analysis | `POST /api/analysis/run` · `GET /api/analysis` · `/latest` · `/:id` · `/:id/mappings` · `/:id/policy-check` · `/mapping/:id` |
| Dashboard | `GET /api/dashboard` |
| Gaps | `GET /api/gaps` · `GET|PATCH /api/gaps/:id` · `GET /api/gaps/:id/draft` |
| Reviews | `GET /api/reviews` · `/summary` · `POST /api/reviews/:id/approve|reject|reopen|comment` · `GET /api/reviews/:id/history` |
| Remediation | `GET|POST /api/remediation` · `PATCH|DELETE /api/remediation/:id` · `POST /api/remediation/bulk-open` |
| Reports | `GET /api/reports/summary` · `GET /api/reports/export?kind=&format=` · `GET /api/reports/workspace` |
| Audit | `GET /api/audit` · `GET /api/audit/:seq` |

`GET /api` returns this list at runtime.

---

## How the analysis works

1. **Scope.** Each requirement carries an applicability rule (`always`, `medicare`, `accredited`, a service key, or `state:XX`). Only matching requirements enter the run.
2. **Vocabulary.** Text is tokenized, stop-words removed, and stemmed crudely (`ies → y`, then trailing `ing|ed|es|s` stripped). An IDF weight is computed across the requirement and policy corpus, so distinctive words carry more signal than common ones.
3. **Negation window.** The tokenizer tracks a seven-token window after negation cues (`not`, `never`, `need not`, `shall not`, `except`, and so on). A term appearing only inside a negation is recorded as contradictory rather than matched — this is what separates "must document" from "need not document".
4. **Score.** Weighted recall: the IDF mass of matched requirement terms over the total. A policy must score ≥ 0.68 to be *Covered*, ≥ 0.34 to be *Partial*.
5. **Classification.** Below the partial threshold, if any policy shows topical overlap above 0.12 the result is *Not addressed* (a policy exists on the subject but is silent on this); otherwise *No policy* (nothing in the library covers the subject).
6. **Joint coverage.** The top three policies are scored as a set. If they collectively clear the covered bar while none does alone, the finding is flagged rather than counted as covered — a surveyor expects one document to answer the obligation.
7. **Remediation.** Uncovered clauses are extracted sentence by sentence, an owner is inferred from fifteen subject-matter patterns, priority weighs the framework's enforcement risk against how far the coverage falls short, and draft policy language is generated in policy voice with the standard sections.

Only policies marked **regulatory scope** are matched. Operational and governance documents stay in the library and are never force-mapped to a citation.

---

## Deployment

The intended split is **Vercel** for the frontend, **Render** (or Railway) for the API, and **Neon** (or Supabase) for Postgres.

### 1. Database — Neon

1. Create a project at [neon.tech](https://neon.tech) and copy the pooled connection string.
2. It must include `?sslmode=require`. The server detects hosted Postgres and enables SSL automatically.

### 2. API — Render

1. Push the repository to GitHub, then create a **New Web Service** on Render pointing at it.
2. Settings:
   - **Root directory:** *(leave blank — the build runs from the repo root)*
   - **Build command:**
     ```
     npm install --include=dev && npm run build --workspace @policy-prism/shared && npm run build --workspace @policy-prism/server
     ```
     `--include=dev` matters: `NODE_ENV=production` makes npm skip devDependencies, and TypeScript lives there.
   - **Start command:**
     ```
     node server/dist/db/migrate.js && node server/dist/server.js
     ```
     This runs compiled JavaScript. Don't use the `db:migrate` npm script here — it calls `tsx`, which won't be installed in a production deploy.
   - **Health check path:** `/health`
3. Environment variables:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | Your Neon connection string |
   | `JWT_SECRET` | A 48-byte random hex string |
   | `NODE_ENV` | `production` |
   | `PORT` | `4000` |
   | `CLIENT_URL` | Your Vercel URL — **set this after step 3** |
   | `LOG_LEVEL` | `combined` |

4. Deploy, then seed once from the Render shell:
   ```bash
   node server/dist/db/seed.js
   ```

`render.yaml` in the repo root is a blueprint that provisions the database and service together if you prefer.

### 3. Frontend — Vercel

1. Import the same repository at [vercel.com](https://vercel.com).
2. Vercel reads `vercel.json`, so the build and output directory are already configured. If you set them manually:
   - **Build command:** `npm install --include=dev && npm run build --workspace @policy-prism/shared && npm run build --workspace @policy-prism/client`
   - **Output directory:** `client/dist`
3. Environment variable:

   | Key | Value |
   | --- | --- |
   | `VITE_API_URL` | Your Render API origin, e.g. `https://policy-prism-api.onrender.com` — **no trailing slash** |

4. Deploy.

### 4. Connect the two

Go back to Render and set `CLIENT_URL` to the Vercel URL Vercel gave you (for example `https://policy-prism.vercel.app`), then redeploy. This is what the CORS allowlist checks — without it the browser blocks every API call.

If you use a custom domain or want preview deployments to work, `CLIENT_URL` accepts a comma-separated list.

### Single-service alternative

To serve everything from Render on one origin, build the client too and set `SERVE_CLIENT=true`. Express then serves `client/dist` and routes non-`/api` paths to `index.html`.

---

## Notes and limitations

- **The matcher is lexical, not semantic.** It compares vocabulary, not meaning. A policy that satisfies a requirement in entirely different words will score low, and one that uses the right words to say the wrong thing scores high — which is exactly why contradiction detection and the human review gate exist.
- **Coverage percentages are not comparable across profile changes.** Changing the facility profile changes the denominator. The run history marks the break explicitly instead of plotting both on one line.
- **Uploaded files are parsed on receipt and the text stored in Postgres.** The upload directory is a staging area, so an ephemeral disk on a hosted platform loses nothing.
- **PDF and scanned-image ingestion are not supported.** Word documents are handled through `mammoth`; PDFs would need an OCR step that is out of scope here.
- **The requirement library shipped in the seed is illustrative.** Citations are real but the requirement text is paraphrased for demonstration; a production deployment would load the authoritative text.
- **Single-tenant by data model.** Every table carries `hospital_id` and every query is scoped by it, so multi-tenancy is a matter of adding facility switching to the UI rather than reshaping the schema.
