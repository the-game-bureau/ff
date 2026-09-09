-- Let a suspect edit their own record.
--
-- WHAT THIS REPLACES
-- The only thing a member could change about themselves was the photograph:
-- supabase/sql/ff_own_mugshot_only.sql granted UPDATE on avatar_data_url and
-- nothing else, and the page offered a REPHOTOGRAPH button to match. A wrong
-- first name, a changed phone number or a handle somebody had outgrown all had
-- to go through the admin screen. This opens the rest of the row to its owner
-- and nobody else.
--
-- WHY TWO FUNCTIONS AND NOT WIDER GRANTS
-- Column privileges are role-wide, not row-wide. Granting authenticated the
-- right to read last_name so that a member can see their own would hand every
-- signed-in member everyone else's, which is exactly what
-- supabase/sql/ff_profiles_hide_contact.sql was written to stop. A SECURITY
-- DEFINER function can be narrower than a grant: it runs as the owner but only
-- ever touches the row belonging to auth.uid(), so the caller reads and writes
-- their own record and has no way to name anyone else's.
--
-- So UPDATE stays revoked at the table, avatar_data_url included: after this
-- runs, _2026_save_my_rap_sheet is the only way a browser writes to a profile
-- row, and js/mugshot-edit.js goes through it like everything else.
--
-- EMAIL IS NOT IN HERE
-- The address is the login (see js/auth-corner.js), and changing it is
-- Supabase's business, not this table's: auth.updateUser({ email }) sends a
-- confirmation link and the account moves when it is clicked. Writing the
-- column here would make the profile disagree with the login for anyone who
-- never clicked. It is returned by the read function so the form can show it,
-- and the admin screen already flags a profile whose email has drifted from
-- the login it belongs to.
--
-- RUN ORDER
-- After supabase/sql/ff_apb_and_sms.sql (which adds sms) and
-- supabase/sql/ff_suspect_colors.sql (which adds color_primary and
-- color_secondary). The functions below name those columns, so creating them
-- first fails outright rather than half-working.
--
-- Run in the Supabase SQL editor. Safe to re-run.

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


-- ---------------------------------------------------------------------------
-- The columns this depends on. Named here so a missing one is reported as the
-- migration that was skipped rather than as a syntax error 40 lines down.
-- ---------------------------------------------------------------------------
do $deps$
begin
  if to_regclass('public._2026_profiles') is null then
    raise exception 'public._2026_profiles does not exist here.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = '_2026_profiles' and column_name = 'sms'
  ) then
    raise exception 'Column sms is missing. Run supabase/sql/ff_apb_and_sms.sql first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = '_2026_profiles' and column_name = 'color_primary'
  ) then
    raise exception 'Colour columns are missing. Run supabase/sql/ff_suspect_colors.sql first.';
  end if;
end
$deps$;


-- ---------------------------------------------------------------------------
-- READ: the caller's own record, whole.
-- Returns no rows for a signed-out caller, and for a signed-in one who has no
-- profile yet - which js/username-gate.js is what answers.
-- ---------------------------------------------------------------------------
create or replace function public._2026_my_rap_sheet()
returns table (
  id              uuid,
  username        text,
  first_name      text,
  last_name       text,
  email           text,
  sms             text,
  avatar_data_url text,
  color_primary   text,
  color_secondary text
)
language sql
stable
security definer
set search_path = public
as $read$
  select p.id, p.username, p.first_name, p.last_name, p.email, p.sms,
         p.avatar_data_url, p.color_primary, p.color_secondary
  from public._2026_profiles as p
  where p.id = auth.uid();
$read$;

revoke all on function public._2026_my_rap_sheet() from public;
grant execute on function public._2026_my_rap_sheet() to authenticated;


-- ---------------------------------------------------------------------------
-- WRITE: the caller's own record, and only ever theirs.
--
-- null means "leave this alone", so the form can send one field or all of them.
-- An empty string means "clear it", except for the username, which nothing on
-- the site works without.
-- ---------------------------------------------------------------------------
create or replace function public._2026_save_my_rap_sheet(
  new_username        text default null,
  new_first_name      text default null,
  new_last_name       text default null,
  new_sms             text default null,
  new_avatar_data_url text default null,
  new_color_primary   text default null,
  new_color_secondary text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $save$
declare
  me             uuid := auth.uid();
  clean_username text;
  saved          public._2026_profiles%rowtype;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  if not exists (select 1 from public._2026_profiles where id = me) then
    raise exception 'You have no record to edit yet' using errcode = 'P0002';
  end if;

  clean_username := nullif(btrim(coalesce(new_username, '')), '');

  -- The same rule the booking form enforces, restated where it cannot be
  -- skipped by editing the page.
  if new_username is not null then
    if clean_username is null then
      raise exception 'Username cannot be blank' using errcode = '22023';
    end if;

    if clean_username !~ '^[A-Za-z0-9_]{3,20}$' then
      raise exception 'Username must be 3 to 20 letters, numbers or underscores'
        using errcode = '22023';
    end if;

    -- Two members with one name are indistinguishable in the ticker, the legal
    -- pad and the archive.
    if exists (
      select 1 from public._2026_profiles
      where lower(username) = lower(clean_username) and id <> me
    ) then
      raise exception 'That username is already booked' using errcode = '23505';
    end if;
  end if;

  update public._2026_profiles set
    username        = coalesce(clean_username, username),
    first_name      = case
                        when new_first_name is null then first_name
                        when btrim(new_first_name) = '' then null
                        else btrim(new_first_name)
                      end,
    last_name       = case
                        when new_last_name is null then last_name
                        when btrim(new_last_name) = '' then null
                        else btrim(new_last_name)
                      end,
    sms             = case
                        when new_sms is null then sms
                        when btrim(new_sms) = '' then null
                        else btrim(new_sms)
                      end,
    avatar_data_url = case
                        when new_avatar_data_url is null then avatar_data_url
                        when new_avatar_data_url = '' then null
                        else new_avatar_data_url
                      end,
    -- Both halves or neither: a pair with one side missing is not a theme, and
    -- every reader of these two columns checks for both before using either.
    color_primary   = case
                        when new_color_primary is null then color_primary
                        when btrim(new_color_primary) = '' then null
                        else btrim(new_color_primary)
                      end,
    color_secondary = case
                        when new_color_secondary is null then color_secondary
                        when btrim(new_color_secondary) = '' then null
                        else btrim(new_color_secondary)
                      end
  where id = me
  returning * into saved;

  return jsonb_build_object(
    'id', saved.id,
    'username', saved.username,
    'first_name', saved.first_name,
    'last_name', saved.last_name,
    'sms', saved.sms,
    'color_primary', saved.color_primary,
    'color_secondary', saved.color_secondary
  );
end;
$save$;

revoke all on function public._2026_save_my_rap_sheet(text, text, text, text, text, text, text) from public;
grant execute on function public._2026_save_my_rap_sheet(text, text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- With the write going through the function, the browser no longer needs
-- UPDATE on the table at all. This is the same lock ff_own_mugshot_only.sql
-- put on it, tightened by one column: that script left avatar_data_url open,
-- and nothing needs it now.
--
-- Note that script names public.ff_profiles, the pre-migration name. Grants and
-- policies followed the rename, so it is still in force - but re-running it
-- against this project would fail on the missing table. Treat this file as the
-- one that describes the current state.
-- ---------------------------------------------------------------------------
revoke update on public._2026_profiles from authenticated;
revoke update on public._2026_profiles from anon;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. Expect no UPDATE rows at all for either browser role, and both
-- functions executable by authenticated only.
-- ---------------------------------------------------------------------------
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = '_2026_profiles'
  and privilege_type = 'UPDATE'
  and grantee in ('anon', 'authenticated');

select p.proname, r.rolname as granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select rolname from pg_roles
  where rolname in ('anon', 'authenticated')
    and has_function_privilege(rolname, p.oid, 'EXECUTE')
) as r
where n.nspname = 'public'
  and p.proname in ('_2026_my_rap_sheet', '_2026_save_my_rap_sheet')
order by p.proname, r.rolname;
