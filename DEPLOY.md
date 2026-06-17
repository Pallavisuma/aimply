# Deploying Aimply (Render + Supabase)

The whole Node server runs on Render. Data + résumés live in Supabase.
Pre-fill stays a **local** helper (it drives the user's own browser).

## 1. Supabase (one-time)
1. SQL Editor → run `supabase-schema.sql` (and `alter table jobs add column if not exists posted timestamptz;` if the table predates it).
2. Storage → **New bucket** → name **`resumes`**, set **Private**. (Résumés are stored here per user.)
3. Settings → API Keys → copy the **Project URL** and the **service_role / secret** key.

## 2. Push to GitHub
Commit everything **except** secrets (`.env` is already git-ignored). Use a **private** repo.

## 3. Render
1. render.com → New → **Web Service** → connect your GitHub repo.
2. Render auto-detects `render.yaml` (build `npm install`, start `node server.mjs`, health `/healthz`).
3. In **Environment**, add the secrets (these are `sync:false` in render.yaml):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
   - `JSEARCH_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`, `GEMINI_API_KEY`
   - `COOKIE_SECURE=1` (already set in render.yaml — keeps login cookies HTTPS-only)
4. Deploy. Your app is live at `https://aimply.onrender.com` (or your chosen name).

Anyone can sign up; each account is isolated (their own searches, jobs, résumé, tracking) — results come from **their** input, nothing shared.

## What runs where
- **On Render (cloud):** signup/login, search (all 5 boards), company scan, application tracking, profile, résumé storage, tailoring (HTML; PDF falls back to HTML since Render has no browser).
- **Local only (each user runs a small helper):** pre-fill into their own Chrome. Hosted pre-fill clicks will no-op on the server.
- **GitHub Actions:** the daily auto-scan + email digest (optional).

## Notes
- Free Render instances sleep when idle and cold-start in ~30s on first hit.
- To enable PDF résumés in the cloud, switch to a Docker deploy with Playwright/Chromium installed (ask and I'll add the Dockerfile).
