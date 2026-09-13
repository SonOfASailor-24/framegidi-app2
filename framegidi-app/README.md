# FrameGidi Production OS

A React + Vite project containing the FrameGidi Production OS (Jobs, Inventory,
Rework, Job Tracking, Installation, Handover, Dashboard).

## ⚠️ Important: storage is currently LOCAL ONLY

This project was originally built as a Claude Artifact, which provides a
`window.storage` API for shared, persistent, multi-device data automatically.
That API does not exist outside Claude.

To make this project runnable at all outside Claude, `src/storageShim.js`
provides a **temporary stand-in** for `window.storage`, backed by the
browser's `localStorage`. This means:

- ✅ The app will load, render, and function.
- ✅ Data survives a page reload on the same browser.
- ❌ Data does **NOT** sync across different phones/devices/browsers.
- ❌ Two people using the app at the same time will each see only their own
  local copy of the data — this defeats the whole point of a shared
  production system.

**Before this is used for real multi-user production work, `storageShim.js`
needs to be replaced with a real backend** (Supabase is a good fit — see
below). All of the app's actual logic (jobs, inventory, materials status,
Fulfillment workflow, etc.) is untouched by this — it only ever calls
`window.storage.get/set/delete/list`, so swapping the shim for a real backend
is a contained change, not a rewrite of the app.

## Getting started locally

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

## Building for production

```bash
npm run build
```

This outputs a static site to `dist/`.

## Deploying

### Option A — Vercel / Netlify (recommended, easiest)
Connect your GitHub repo to Vercel or Netlify. Both auto-detect Vite projects —
no configuration needed. Every push to `main` deploys automatically.

### Option B — GitHub Pages
1. In `vite.config.js`, uncomment and set:
   ```js
   base: '/your-repo-name/',
   ```
2. Run `npm run build`.
3. Deploy the `dist/` folder to a `gh-pages` branch (e.g. using the
   `gh-pages` npm package, or a GitHub Actions workflow).

## Migrating to real shared storage (Supabase)

Only `src/storageShim.js` needs to be replaced. Create a Supabase project
with a single table:

```sql
create table storage (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
```

Then reimplement `window.storage.get/set/delete/list` in `storageShim.js` to
call Supabase's client (`select`, `upsert`, `delete`, and `like('key', prefix
+ '%')` for listing) instead of `localStorage`. The rest of the app requires
no changes.

Real authentication (Supabase Auth) is also recommended before production
use — the current login is name-selection only, with no password or account
security.
