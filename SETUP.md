# Hartmann CRM — Setup & Operations

The CRM has three parts:

1. **Frontend** (static): `index.html` + `config.js`, `util.js`, `migration.js`, `persistence.js`, `views.js`, `modals.js`, `app.js`. Served from the `gh-pages` branch via GitHub Pages.
2. **Backend** (`server/`): a Cloudflare Worker (`hartmann-crm-api`) that authenticates requests and reads/writes `data.json` through the GitHub Contents API.
3. **Data**: `data.json` on the `data` branch of this repository. The frontend never talks to GitHub directly and never contains a GitHub credential.

## Security rules (do not break these)

- Never put a GitHub token, access key, or any credential in frontend files, `config.js`, HTML, or this repository.
- CORS is not authentication. The Worker enforces `Authorization: Bearer <team key>` on every read and write.
- The GitHub token exists only as a Worker secret (`GITHUB_TOKEN`).
- If a credential is ever exposed, revoke it immediately and issue a replacement; do not edit around it.

## 1. Revoke the old exposed token

The previous version of `index.html` (still live on the `gh-pages` branch until you deploy the new frontend, and present in git history on `main`, `gh-pages`, and `data`) contained a classic personal access token assembled from string parts in client-side JavaScript.

1. GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**.
2. Delete the token that belongs to this repository's automation (the one with `repo` scope used for the old app). Do not copy it anywhere, including chat or tickets.
3. Confirm it is gone before continuing.

## 2. Create the backend GitHub token

Create a **fine-grained** personal access token (Settings → Developer settings → Personal access tokens → Fine-grained tokens):

- Resource owner: `Suzana991`
- Repository access: only `hartmann-crm`
- Permissions → Repository permissions → **Contents: Read and write** (nothing else)
- Expiration: per your policy

This token can only touch this one repository's file contents. The Worker additionally pins it to branch `data`, path `data.json`.

## 3. Team access keys (private links)

Each approved team member gets their own access key and a private access link built from it (never share one key or link between people):

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Run once per member, then form that person's private link (send through a secure channel, never over a channel that logs URLs):

```
https://suzana991.github.io/hartmann-crm/#key=<their key>
```

The key travels in the URL **fragment** (after `#`), so it never reaches any server in the URL. On first open the app stores the key on that device (`localStorage`), removes it from the visible URL, and loads the CRM. Later visits to the same device open the CRM directly — there is no login, registration, or user-management screen in the app. A missing or invalid key shows the message "Open your private access link".

Keys are stored in the Worker secret `AUTH_TOKENS` as a comma-separated list. The Worker compares SHA-256 hashes of presented keys, so keys are never logged or returned. Each key works independently:

- **Add a member**: generate a key, re-run `npx wrangler secret put AUTH_TOKENS` with the full comma-separated list including the new key, build their private link, and send it through a secure channel.
- **Revoke a member**: re-run `npx wrangler secret put AUTH_TOKENS` with the list minus their key. Access stops immediately for that person only; their device shows "Open your private access link" until they receive a new link. Other members are unaffected.
- Never print keys or links in deployment logs, shell transcripts, or commits. Read them from a local file and pipe the value into wrangler (for example: `$list = Get-Content $env:TEMP\hartmann-team-keys.txt -Raw; $list | npx wrangler secret put AUTH_TOKENS`).

## 4. Deploy the backend

Prerequisites: Node.js 18+, a Cloudflare account, `wrangler` logged in.

```powershell
cd server
npm install
npx wrangler login                     # or set CLOUDFLARE_API_TOKEN
npx wrangler secret put GITHUB_TOKEN   # paste the fine-grained token from step 2
npx wrangler secret put AUTH_TOKENS    # comma-separated team keys from step 3
npx wrangler deploy
```

`server/wrangler.toml` already pins the storage scope:

| Var | Value |
| --- | --- |
| `GITHUB_OWNER` | `Suzana991` |
| `GITHUB_REPO` | `hartmann-crm` |
| `GITHUB_BRANCH` | `data` |
| `DATA_PATH` | `data.json` |
| `CORS_ORIGIN` | `https://suzana991.github.io` |

Note the deploy URL, e.g. `https://hartmann-crm-api.<account>.workers.dev`.

Verify before touching the frontend:

```powershell
# no key -> must return 401
Invoke-WebRequest "https://hartmann-crm-api.<account>.workers.dev/api/data" -UseBasicParsing
# with key -> must return 200 with {"data":..., "sha":...}
Invoke-WebRequest "https://hartmann-crm-api.<account>.workers.dev/api/data" -UseBasicParsing -Headers @{ Authorization = "Bearer <a-team-key>" }
```

Never paste the `GITHUB_TOKEN` into either command.

## 5. Point the frontend at the backend

Edit `config.js` in the repo root:

```js
window.CRM_CONFIG = {
  apiBase: "https://hartmann-crm-api.<account>.workers.dev",
  appName: "Hartmann CRM"
};
```

`apiBase` is a URL, not a secret. Leave it `""` only for local development (the dev server overrides `config.js` automatically).

## 6. Deploy the frontend (GitHub Pages)

There are no GitHub Actions workflows in this repo; `gh-pages` is deployed manually.

```powershell
git checkout gh-pages
git checkout main -- index.html config.js util.js migration.js persistence.js views.js modals.js app.js
git commit -m "Deploy CRM frontend"
git push origin gh-pages
git checkout main
```

**Deploy order matters:** backend first (step 4, verified), then frontend (this step), and only then revoke the old token (step 1). Do not push anything to the `data` branch as part of a deploy.

## 7. First run & data migration

On first load the app detects the legacy dataset, migrates it in the browser to schema v2, stores the untouched original as `legacyBackup` inside the same file, and saves the migrated state through the backend. You will see the "Migrated from the legacy dataset" banner on the Overview afterwards.

- The migration preserves institutions, contacts, outreach fields, and the existing task verbatim; nothing is invented or discarded.
- Items worth a human look are flagged (invalid email formats, ambiguous outreach records) and counted in "Needs review".
- Idempotent: loading already-migrated data is a no-op.
- If the stored schema is newer than the build supports, the app refuses to open it instead of corrupting it.

## 8. Day-to-day operations

- **Auto-save**: edits debounce and save within ~1s; the sidebar shows `Saving…` → `Saved <time>`. Click a red status to retry immediately; retries also happen automatically every 15s after a failure.
- **Concurrent edits**: each save carries the base content hash. If someone else saved first, the app shows a conflict dialog — load theirs or overwrite with yours. Nothing is ever silently overwritten.
- **Exports**: `JSON` (full backup, re-importable) and `CSV` (spreadsheet view) in the sidebar. Export JSON before large bulk changes.
- **Import**: JSON accepts both legacy and v2 files (REPLACE or MERGE prompt); CSV adds investors/contacts/engagements to the current project.
- **Reload**: re-reads from the backend; warns first if you have unsaved changes.
- **Browser tabs**: navigating away with unsaved changes triggers the browser's "leave site?" prompt.

## 9. Local development

```powershell
node server/src/dev-server.js
```

- Serves the frontend at `http://127.0.0.1:8788` with `config.js` overridden to the local API.
- Runs the real API handler against a local file emulator (no GitHub calls).
- Data file: `%TEMP%\hartmann-crm-dev-data.json`, seeded from `tests/fixtures/legacy-data.json` (a copy of the real legacy data).
- Dev access key: `dev-token` (override with `DEV_TOKEN=...`).
- Reset to pristine legacy data: `DEV_RESET=1 node server/src/dev-server.js`.

## 10. Tests

```powershell
# migration rules (uses the real legacy fixture)
node --test tests\migration.test.js

# backend auth, scoping, conflicts, validation
cd server
npm test
```

Browser checks (needs Edge + `playwright-core` installed where `createRequire` can find it, default `%TEMP%\pw`):

```powershell
node server/src/dev-server.js   # in one shell
node tests\browser-check.mjs    # in another; writes screenshots to %TEMP%\crm-shots
```

The browser suite covers: first access through a private link (key stripped from URL), legacy migration, tracker/directory/detail rendering, contact display fallback, create investor/contact/engagement/activity/task, reload persistence, export, failed-save + retry, invalid-key rejection with the access-link message, and a two-session 409 conflict.

Access-link suite (first access, returning visits, invalid/missing keys, per-key revocation — keys supplied via `CRM_KEY1`/`CRM_KEY2` env read from the local key file, `CRM_PHASE=1|2`):

```powershell
node tests\access-link-check.mjs
```

## 11. Recovery

- **Data loss / bad edit**: re-import the latest JSON export; or restore `data.json` on the `data` branch from GitHub's file history (branch → History → commit → view file → copy).
- **Backend down**: the frontend shows `Save failed — retrying` and retries every 15s; work continues in the tab and is written once the backend returns. Exports still work offline.
- **Locked out (all keys bad)**: `npx wrangler secret put AUTH_TOKENS` with a fresh key list.
- **Schema written by a newer build**: deploy the matching frontend, or restore the previous `data.json` from branch history.
