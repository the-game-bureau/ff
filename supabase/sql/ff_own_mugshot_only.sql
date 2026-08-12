-- Own mugshot, and nothing else.
--
-- The lineup page now offers a REPHOTOGRAPH button on the signed-in player's
-- own card (js/mugshot-edit.js). Hiding the button on everybody else's card is
-- a UI decision and a UI decision only: the same UPDATE can be sent by hand
-- with the anon key, which every visitor has. So the rule lives here as well.
--
-- Two locks, because they stop different things:
--   * the policy stops you writing to another player's ROW
--   * the column grant stops you writing to another COLUMN of your own row —
--     without it, "change my mugshot" is also "change my username", and
--     usernames are how picks, the ticker and the archive identify people.
--
-- Run in the Supabase SQL editor. Safe to re-run.

alter table public.ff_profiles enable row level security;

drop policy if exists ff_profiles_update_own on public.ff_profiles;

-- using: which existing rows you may touch. with check: what they may look like
-- afterwards. Both are needed — without the check, an update could hand the row
-- to somebody else's id on the way out.
create policy ff_profiles_update_own
  on public.ff_profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Table-wide UPDATE is replaced by a grant on the one column the site ever
-- updates (see updateSignedInUserMugshot in js/join.js, and js/mugshot-edit.js
-- — the only two writers). INSERT is untouched: booking still writes the whole
-- row through the join form.
revoke update on public.ff_profiles from authenticated;
-- Signed out, you may look at the lineup and nothing else.
revoke update on public.ff_profiles from anon;
grant update (avatar_data_url) on public.ff_profiles to authenticated;

-- Check afterwards: this should list exactly one column.
--   select grantee, privilege_type, column_name
--     from information_schema.column_privileges
--    where table_name = 'ff_profiles'
--      and privilege_type = 'UPDATE';
