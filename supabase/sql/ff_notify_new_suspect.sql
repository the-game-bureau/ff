-- Tell me when somebody joins.
--
-- An INSERT into _2026_profiles fires a repository_dispatch at GitHub, and
-- .github/workflows/new-suspect.yml opens an issue. Watching the repo is what
-- turns that into an email, so nothing here has to know an address or run a
-- mail server.
--
-- THE VAULT SECRET DOES NOT SURVIVE A PROJECT MOVE. This bit here.
-- Restoring this database into a new Supabase project brought the table, the
-- function and the trigger across intact — and left the token behind, because
-- vault secrets are encrypted per project and are not part of a dump. The
-- trigger then did exactly what it is written to do with no token: logged a
-- warning and returned, so four people joined over three days and nothing was
-- ever sent. Nothing was broken and nothing looked broken. After ANY move,
-- re-create the secret in step 2 and fire a real test signup.
--
-- The old project keeps its copy of the token and its own trigger, so it can
-- still open issues in this repo long after the site stopped pointing at it.
-- If you have finished with a project, revoke that token at GitHub rather than
-- leaving a live credential in a database nobody is watching.
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

-- ---------------------------------------------------------------------------
-- WRONG-DATABASE GUARD. The Supabase editor gives no hint which project is
-- open, and these scripts have been run against the wrong one: they succeed,
-- report a clean pass, and change nothing the site can see. _2026_picks is the
-- marker because it exists only in the project js/supabase-config.js points at.
-- The editor runs a file as one transaction, so this raise rolls back
-- everything after it.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public._2026_picks') is null then
    raise exception
      'Wrong database: public._2026_picks does not exist here. Open the project '
      'named in js/supabase-config.js and run this again.';
  end if;
end
$guard$;


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
create or replace function public._2026_notify_new_suspect()
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
    raise warning '_2026_notify_new_suspect: no github_dispatch_token in vault, skipping';
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
    raise warning '_2026_notify_new_suspect failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists _2026_notify_new_suspect_after_insert on public._2026_profiles;
create trigger _2026_notify_new_suspect_after_insert
after insert on public._2026_profiles
for each row
execute function public._2026_notify_new_suspect();


-- ---------------------------------------------------------------------------
-- Verify. One statement on purpose: the Supabase editor shows only the LAST
-- result of a batch, so three separate selects means seeing one of them and
-- assuming the other two passed. That is how a missing token went unnoticed
-- through four signups. Every row is always returned, and an absent thing says
-- so in words rather than by not being there.
--
-- Expected: the trigger enabled (O), the token present, and — after a real
-- test signup — a dispatch with status 204, which is how GitHub answers a
-- repository_dispatch. 401 means the token is wrong or expired; 404 means it
-- cannot see the repo, usually the wrong repository on a fine-grained token.
-- ---------------------------------------------------------------------------
select 'trigger on _2026_profiles' as check,
       coalesce(
         (select string_agg(tgname || ' (' || tgenabled::text || ')', ', ')
            from pg_trigger
           where tgrelid = 'public._2026_profiles'::regclass
             and not tgisinternal),
         '*** NONE — nothing fires on signup ***') as result
union all
select 'github_dispatch_token in vault',
       coalesce(
         -- The name and the date only. Never select the secret itself into the
         -- editor: the result sits in the query history afterwards.
         (select 'present, created ' || created_at::text
            from vault.secrets
           where name = 'github_dispatch_token'),
         '*** MISSING — trigger logs a warning and skips ***')
union all
select 'most recent dispatch attempt',
       coalesce(
         (select 'status ' || coalesce(status_code::text, '?')
                 || ' at ' || created::text
                 || coalesce(' — ' || nullif(error_msg, ''), '')
            from net._http_response
           order by created desc
           limit 1),
         '*** none ever sent from this project ***');
