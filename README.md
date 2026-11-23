# 20/7

Count your sets per muscle group each week, toward a weekly goal, and keep an eye on your daily steps.

## What's here

| Folder | What it holds |
| --- | --- |
| `web/` | The web app, published to GitHub Pages. Static files, no build step. |
| `ios/` | The iPhone app (SwiftUI, reads steps from Apple Health). |
| `supabase/migrations/` | The database: tables, privacy rules and history queries. |
| `supabase/email/` | Sign-in and invite email templates to paste into Supabase. |
| `supabase/tests/` | Checks for the database, run against a local Postgres. |

## Backend

Supabase (Postgres with sign-in), EU region. Every table only lets a person read and write their own rows. The web app and the iPhone app use the public (publishable) key; the secret key never goes into this repository.

## Testing the database

```sh
npm install @electric-sql/pglite
node supabase/tests/run.mjs ./node_modules
```
