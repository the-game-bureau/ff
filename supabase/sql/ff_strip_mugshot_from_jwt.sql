-- Repair: remove mugshots from auth user_metadata.
--
-- THE BUG
-- The join form used to pass avatar_data_url into signUp's options.data.
-- Everything in that object becomes user_metadata, and Supabase embeds
-- user_metadata in the JWT. The JWT is sent in the Authorization header of
-- every authenticated request.
--
-- A 256x256 mugshot encoded as a PNG data URL runs from roughly 36,000
-- characters for a simple photo to 234,000 for a detailed one. A typical HTTP
-- header limit is 8,192, and the JWT base64-encodes the payload on top of
-- that, so even the small end is several times over. The gateway therefore
-- rejected every request from an affected account with a bodyless 400 before
-- PostgREST ever saw it, which surfaced as "Bad Request" with no error code on
-- the profile fetch, the lineup, and everything else. The account could sign
-- in and then do nothing at all.
--
-- Measured on this project: both affected accounts carried 36,659 characters.
--
-- js/join.js no longer writes it, so new accounts are unaffected. Accounts
-- created before that fix still carry the blob and cannot repair themselves:
-- the updateUser call that would clear it is itself an authenticated request,
-- so it fails the same way. It has to be cleared here.
--
-- Nothing is lost. The mugshot's real home is ff_profiles.avatar_data_url,
-- which is a column and never touches a header; query 1 confirms that copy
-- exists before anything is removed.

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


-- 1. Who is affected, how big is their token, and is the mugshot safely stored
--    in ff_profiles? Only rows with profile_has_mugshot = true are safe to
--    strip without losing the image.
select
  u.id,
  u.email,
  length(u.raw_user_meta_data ->> 'avatar_data_url') as metadata_mugshot_chars,
  (p.avatar_data_url is not null and p.avatar_data_url <> '') as profile_has_mugshot
from auth.users u
left join public.ff_profiles p on p.id = u.id
where u.raw_user_meta_data ? 'avatar_data_url'
order by metadata_mugshot_chars desc nulls last;

-- 1b. IMPORTANT before step 3. Step 2 is an UPDATE, so it can only rescue a
--     mugshot into an ff_profiles row that already exists. An auth user with
--     no profile row at all (a half-finished join) will have its mugshot
--     destroyed by step 3 with nothing to fall back on. This lists them.
--     Such an account cannot play anyway — no username — so deleting it is
--     usually the right answer:
--       delete from auth.users where id = '<the id below>';
select u.id, u.email, u.created_at
from auth.users u
left join public.ff_profiles p on p.id = u.id
where u.raw_user_meta_data ? 'avatar_data_url'
  and p.id is null;

-- 2. Rescue any mugshot that exists ONLY in metadata, so nothing is lost when
--    step 3 strips it. Safe to run even if it copies nothing.
update public.ff_profiles p
   set avatar_data_url = u.raw_user_meta_data ->> 'avatar_data_url'
  from auth.users u
 where u.id = p.id
   and u.raw_user_meta_data ? 'avatar_data_url'
   and (p.avatar_data_url is null or p.avatar_data_url = '');

-- 3. Strip the key from the token payload. The "- 'key'" operator removes it
--    from the jsonb object and leaves username / first_name / last_name alone.
update auth.users
   set raw_user_meta_data = raw_user_meta_data - 'avatar_data_url'
 where raw_user_meta_data ? 'avatar_data_url';

-- 4. Confirm. Should return zero rows.
select id, email
from auth.users
where raw_user_meta_data ? 'avatar_data_url';

-- AFTERWARDS: an affected account is still holding its old oversized JWT in
-- localStorage. Sign out and back in (or clear site data) to be issued a new
-- one. Until then that browser keeps sending the old header and keeps failing.
