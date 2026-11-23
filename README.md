# 20/7

Count your sets per muscle group each week, toward a weekly goal, and keep an eye on your daily steps.

Web app: https://mgadzhimagomaev.github.io/twentyseven/

## What's here

| Folder | What it holds |
| --- | --- |
| `web/` | The web app, published to GitHub Pages. Static files, no build step. |
| `ios/` | The iPhone app (SwiftUI, reads steps from Apple Health). |
| `supabase/migrations/` | The database: tables, privacy rules and history queries. Run them in order. |
| `supabase/email/` | Sign-in and invite email templates to paste into Supabase. |
| `supabase/tests/` | Checks for the database, run against a local Postgres. |
| `tests/web/` | Checks for the web app in a real browser, against a stand-in backend. |
| `.github/workflows/` | Publishes `web/` to GitHub Pages on every push to `main`. |

## Backend

Supabase (Postgres with sign-in), EU region. Every table only lets a person read and write their own rows. The web app and the iPhone app use the public (publishable) key; the secret key never goes into this repository.

Sign-in is by email: a one-time code once the email templates in `supabase/email/` are in place (they need your own email sender), a link until then. The app accepts both.

## Running the web app locally

Any static file server works, for example:

```sh
python3 -m http.server -d web 8000
```

Then open http://localhost:8000. It talks to the real database.

## Tests

```sh
# database
npm install @electric-sql/pglite
node supabase/tests/run.mjs ./node_modules

# web app (needs Playwright with Chromium); screenshots go to the folder given
node tests/web/run.mjs [screenshot folder]
```

## Publishing

Every push to `main` that changes `web/` publishes it with GitHub Actions. The workflow stamps the commit into `web/sw.js`, so installed copies pick up the new files on their next launch.
