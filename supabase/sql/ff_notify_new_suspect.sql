-- Tell me when somebody joins.
--
-- An INSERT into ff_profiles fires a repository_dispatch at GitHub, and
-- .github/workflows/new-suspect.yml opens an issue. Watching the repo is what
-- turns that into an email, so nothing here has to know an address or run a
-- mail server.
--
-- ONLY THE USERNAME TRAVELS. Not the email, not the real name. A GitHub issue
-- is readable by everyone with access to the repo and is effectively permanent;
-- a username is already public on the lineup page, and the rest is not.
--
-- Delivery is fire-and-forget. pg_net queues the request and the INSERT commits
-- whether or not GitHub answers, which is the right way round: a failed
-- notification must never cost somebody their signup.
--
-- SETUP, in order:
--   1. Create a fine-grained personal access token at
--      https://github.com/settings/tokens?type=beta
--        Repository access: only the-game-bureau/ff
--        Permissions: Contents = Read and write  (that is what repository_dispatch needs)
--      Nothing else. It cannot touch any other repo, and it cannot read code
--      outside this one.
--   2. Store it in Vault, replacing the placeholder:
--        select vault.create_secret('ghp_yourtokenhere', 'github_dispatch_token');
--      To rotate later:
--        select vault.update_secret(
--          (select id from vault.secrets where name = 'github_dispatch_token'),
--          'ghp_newtokenhere');
--   3. Run the rest of this file.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- pg_net makes HTTP requests from Postgres without blocking the transaction.
-- No "with schema": pg_net is not relocatable and installs into its own `net`
-- schema. Naming a schema here fails, and because the SQL editor runs the file
-- as one batch, that single error rolls back everything below it — including
-- the trigger, which is then silently absent.
create extension if not exists pg_net;


-- ---------------------------------------------------------------------------
-- The trigger. AFTER INSERT, so the row is already committed to disk before
-- anything is announced — no notification for a signup that then rolled back.
-- ---------------------------------------------------------------------------
create or replace function public.ff_notify_new_suspect()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions, vault
as $$
declare
  github_token text;
begin
  -- Read the token at fire time rather than caching it, so a rotation takes
  -- effect on the next signup with nothing to redeploy.
  select decrypted_secret into github_token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token';

  -- No token configured yet. Nothing to do, and emphatically not a reason to
  -- fail the insert: someone joining the league matters more than telling me
  -- about it.
  if github_token is null then
    raise warning 'ff_notify_new_suspect: no github_dispatch_token in vault, skipping';
    return new;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/the-game-bureau/ff/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || github_token,
      'Accept',        'application/vnd.github+json',
      'Content-Type',  'application/json',
      'User-Agent',    'ff-supabase-trigger'
    ),
    body    := jsonb_build_object(
      'event_type',     'new-suspect',
      -- Username only. See the note at the top of this file.
      'client_payload', jsonb_build_object('username', new.username)
    )
  );

  return new;
exception
  -- Any failure here — network, GitHub down, a revoked token — is logged and
  -- swallowed. The signup stands.
  when others then
    raise warning 'ff_notify_new_suspect failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists ff_notify_new_suspect_after_insert on public.ff_profiles;
create trigger ff_notify_new_suspect_after_insert
after insert on public.ff_profiles
for each row
execute function public.ff_notify_new_suspect();


-- ---------------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------------

-- 1. The token is in the vault. Expect one row. (Never select the secret
--    itself into a shared SQL editor — the name is enough to confirm.)
select name, created_at from vault.secrets where name = 'github_dispatch_token';

-- 2. The trigger is attached. Expect one row.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.ff_profiles'::regclass
  and not tgisinternal;

-- 3. Fire it for real by joining with a throwaway account, then read the
--    delivery log. status_code 204 is success — GitHub answers a dispatch with
--    No Content. 401 means the token is wrong or expired, 404 means the token
--    cannot see the repo (usually the wrong repository selected on a
--    fine-grained token).
select id, status_code, error_msg, created
from net._http_response
order by created desc
limit 5;
