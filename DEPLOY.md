# Deploying Policy Prism

One service serves both the API and the built React app, so there is a single
URL, no CORS to configure between them, and no `VITE_API_URL` to keep in sync.

Roughly fifteen minutes. Your database already exists, so nothing here touches
your data.

---

## Before you start

You need:

- A **GitHub account** — Render deploys from a repository
- Your **Neon connection string** — already in `server/.env`
- A **Render account** — free tier, no card required

---

## 1. Push to GitHub

Render deploys from a repo, so the code needs to be there first.

```bash
cd ~/Downloads/pp/policy-prism
git init
git add -A
git commit -m "Policy Prism"
```

Check that `.env` did **not** get committed — it holds your database password:

```bash
git ls-files | grep -c "\.env$"
```

That must print `0`. If it prints anything else, stop and fix `.gitignore`
before pushing.

Create an empty **private** repository on github.com, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/policy-prism.git
git branch -M main
git push -u origin main
```

---

## 2. Create the Render service

1. Go to **dashboard.render.com** → **New** → **Web Service**
2. Connect your GitHub account and pick the repository
3. Render reads `render.yaml` and fills most fields in. Confirm:

   | Field | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install --include=dev && npm run build --workspace @policy-prism/shared && npm run build --workspace @policy-prism/client && npm run build --workspace @policy-prism/server` |
   | Start command | `node server/dist/server.js` |
   | Health check path | `/health` |

`--include=dev` matters: `NODE_ENV=production` makes npm skip devDependencies,
and TypeScript and Vite both live there.

---

## 3. Set the environment variables

In the service's **Environment** tab:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Your Neon connection string |
| `JWT_SECRET` | Click **Generate** |
| `NODE_ENV` | `production` |
| `SERVE_CLIENT` | `true` |
| `PORT` | `4000` |
| `LOG_LEVEL` | `combined` |

Deploy. Render gives you a URL such as
`https://policy-prism-xxxx.onrender.com`.

---

## 4. Point the app at its own URL

Two variables need the real URL, which you only learn after the first deploy.
Add them, then redeploy:

| Key | Value |
| --- | --- |
| `CLIENT_URL` | `https://policy-prism-xxxx.onrender.com` |
| `APP_URL` | the same URL |

`CLIENT_URL` is the CORS allowlist. `APP_URL` builds the links inside password
reset emails — without it, those links point at localhost.

---

## 5. Check it

```
https://your-app.onrender.com/health
```

Should return `{"success":true,"data":{"status":"ok","database":"connected"}}`.

Then open the root URL and sign in. Your existing data is there, because the
deployment points at the same Neon database you have been using locally.

---

## Email (optional)

Password resets need a provider in production — the local test-mailbox fallback
is deliberately disabled when `NODE_ENV=production`, since a deployed app
quietly sending resets to a throwaway inbox would be dangerous.

Add to the Environment tab:

| Key | Value |
| --- | --- |
| `RESEND_API_KEY` | Your key from resend.com |
| `MAIL_FROM` | `Policy Prism <noreply@yourdomain.com>` |

The sender domain must be verified in Resend. Their sandbox sender
(`onboarding@resend.dev`) only delivers to the address you registered with, so
it is fine for a smoke test and useless for real users.

Without a provider the app still runs; the reset endpoint reports that no link
could be issued rather than pretending.

---

## Notes

**Free tier sleeps.** Render spins the service down after 15 minutes idle, and
the next request takes 30–50 seconds to wake it. Fine for a demo, wrong for a
pilot — the paid tier removes it.

**Uploads are ephemeral.** Files land on a disk that is wiped on each deploy.
This does not lose anything: uploaded documents are parsed on receipt and the
text stored in Postgres. The upload directory is only a staging area.

**Schema changes.** Your database already has the current schema. If you later
add a migration, apply it with `psql` against Neon before deploying — Drizzle's
migrator hangs on Neon's pooled endpoint, which is why the migrations here were
applied that way.

**Rotate the database password.** It has been shared during development. Neon
lets you reset it from the dashboard; update `DATABASE_URL` in Render and in
your local `server/.env` afterwards.

---

# Docker

## Run the whole stack locally

Brings up the app and its own Postgres, with the schema applied on first boot:

```bash
docker compose up --build
docker compose exec app npm run db:seed --workspace server
```

Then open http://localhost:4000 and sign in with the demo accounts.

No Node, no local Postgres, no `.env` — useful for onboarding someone, or for
checking that a change works on a clean machine rather than only on yours.

## Build the image alone

```bash
docker build -t policy-prism .
docker run --rm -p 4000:4000 \
  -e DATABASE_URL="$(grep '^DATABASE_URL=' server/.env | cut -d= -f2-)" \
  -e JWT_SECRET="$(grep '^JWT_SECRET=' server/.env | cut -d= -f2-)" \
  policy-prism
```

The image is multi-stage: build tooling stays in the builder, and what ships is
the compiled server, the built client, and production dependencies. It runs as a
non-root user, because the component parsing uploaded files is exactly the one
worth confining.

---

# Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`.

| Step | Why it is there |
| --- | --- |
| Build shared, client, server | The client build is the real gate — it catches duplicate declarations and unresolved imports that `tsc` alone lets through |
| Typecheck client | Enforced |
| Typecheck server | Advisory only: a known `@types/express` version clash emits errors while still producing correct JavaScript |
| Check no `.env` is tracked | Fails the build if a secret was committed |
| Verify build output | Confirms all three workspaces produced files — a server without `client/dist` starts happily and 404s every page |
| Build and start the Docker image | Building proves it compiles; starting it against a real Postgres proves it runs |

## Deployment

`.github/workflows/deploy.yml` publishes the image to GitHub Container Registry
and calls a deploy hook — **but only when CI passed on that commit**.

That gate exists for a specific reason: a build error was once pushed to `main`
and deployed anyway, because the push ran whether or not the build succeeded.

To enable automatic deployment, add one repository secret:

- `RAILWAY_DEPLOY_HOOK` — the deploy hook URL from Railway or Render

Without it the step is skipped rather than failed, so a fresh clone does not
show a red pipeline for a secret it was never given.

**Migrations are not run automatically.** Applying schema changes to a live
database is a decision, not a side effect of merging. Run new files in
`server/drizzle/` with `psql` yourself.
