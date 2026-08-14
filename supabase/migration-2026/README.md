# 2026 Supabase migration

Source project currently used by the site:

- Project ref: `qmaafbncpzrdmqapkkgr`
- URL: `https://qmaafbncpzrdmqapkkgr.supabase.co`

Destination project:

- Org: `Fantasy Football`
- Project: `Gridiron Football League`
- Project ref: `vkoczgzizzppdrpvpemh`
- URL: `https://vkoczgzizzppdrpvpemh.supabase.co`

## Scope

This migration moves everything this repo depends on:

- Supabase Auth users, including password hashes in `auth.users.encrypted_password`
- public app tables, renamed to `_2026_*`
- public views, triggers, RLS policies, grants, and admin RPCs
- the GitHub notification Vault secret, if you still want join notifications

Supabase-managed tables in `auth`, `storage`, and other internal schemas will not
start with `_2026`. Do not rename those; Supabase Auth expects them to keep their
managed names. The `_2026` rule is for repo-owned public tables.

## No-downtime shape

Branching is the right move. Production stays on `main` against the old project
while the new project is built and tested on this branch. The final website cutover
is only a config change in `js/supabase-config.js`.

Important: a branch prevents website deploy downtime, but it does not freeze data.
This is a browser-only app writing directly to Supabase Auth and public tables, so
the final migration must avoid data drift one of these ways:

- quiet-window cutover: run a final dump/restore immediately before deployment,
  while nobody is joining or submitting picks
- brief write freeze: temporarily disable joining/picking, run final dump/restore,
  deploy the new config, then re-enable writes
- replication: use logical replication for a tighter write window; this is heavier
  and should be tested separately before involving Auth

Reads can stay up the whole time because the old site and old project are untouched
until the new branch is verified.

## Preflight

## Where things go

You do not run this README in Supabase. This README is the checklist. The actual
database migration command runs in PowerShell from this repo.

Put secrets here:

| Thing | Where it goes |
| --- | --- |
| Old direct database connection string | PowerShell env var `$env:OLD_DB_URL`; never commit it |
| New direct database connection string | PowerShell env var `$env:NEW_DB_URL`; never commit it |
| New publishable key | `js/supabase-config.js` only at final website cutover |
| GitHub notification token | Supabase SQL editor, stored in Vault with `vault.create_secret` |
| JWT secret, if preserving sessions | Supabase Dashboard project settings, before using final API keys |

Install:

- PostgreSQL client tools, which provide `pg_dump` and `psql`

This script does not use `supabase db dump`, because that command requires Docker
Desktop. It uses the PostgreSQL tools installed locally instead.

In the new Supabase project, decide whether users should stay logged in:

- Best session continuity: set the new project's JWT secret to the old project's
  JWT secret before using the final publishable key. Supabase regenerates API keys
  when the JWT secret changes, so use the post-change publishable key.
- Simpler cutover: keep the new default JWT secret. Passwords still work after
  migration, but existing browser sessions will need to log in again.

Configure Auth URL settings in the new project before testing:

- Site URL: the production URL you actually serve
- Redirect URLs: production root, production `suspects/index.html`, any alternate
  production domain still in use, and local preview URLs used for testing such
  as `http://127.0.0.1:8787/**`

Do not paste connection strings, database passwords, service-role keys, JWT secrets,
OpenAI keys, or GitHub tokens into chat or commit them to this repo.

## Database restore

Set connection strings only in your local PowerShell process:

```powershell
$env:OLD_DB_URL = "postgresql://..."
$env:NEW_DB_URL = "postgresql://postgres.vkoczgzizzppdrpvpemh:..."
```

Run:

```powershell
.\supabase\migration-2026\migrate-dump-restore.ps1
```

The script:

1. Dumps the old project's public schema, `public.ff_*` data, and Auth user data with `pg_dump`.
2. Restores those dumps into the new project with `psql`.
3. Runs `020_after_restore_prefix_public_objects.sql`.
4. Runs `030_verify_destination.sql`.

The verifier fails if any `public` base table does not start with `_2026`. That is
intentional. If the old shared project has unrelated public tables for another app,
exclude them from the dump or move them out before using this script.

Generated dump files land in `supabase/migration-2026/out/`, which is gitignored
because it can contain Auth hashes and personal data.

## After restore

Recreate project secrets that do not safely travel through a logical dump:

```sql
select vault.create_secret('ghp_yourtokenhere', 'github_dispatch_token');
```

Then edit `js/supabase-config.js` to match
`supabase/migration-2026/supabase-config.target.example.js`, replacing only the
publishable key placeholder with the real destination publishable key.

## Verify before cutover

On a branch/preview deploy pointed at the new project:

- signed-out home, victims, suspects, law, and case-file pages load
- username or email login works for an existing migrated user
- password reset email opens the reset modal and changes the password
- a user can update their own mugshot
- a test user can join and appears in `_2026_profiles`
- a test pick inserts into `_2026_picks` and fills schedule columns
- admin login can load records, roster, archive, and schedule reconciliation

Do not merge/deploy the new config until the verification SQL counts match the old
project counts for Auth users, profiles, picks, and schedule rows.

## Rollback

Rollback is simple as long as the old project is not modified or deleted:

1. Deploy `main` or revert `js/supabase-config.js` to the old project.
2. Leave the destination project intact for investigation.
3. Re-run the final dump/restore later, because writes made to the old project after
   the first dump will not be in the destination.

## References

- Supabase Auth user migration: https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
- Supabase backup/restore CLI flow: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Postgres migration strategies: https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres
