-- The Squad Room to do list.
--
-- WHAT IT IS
-- A scratchpad on admin/index.html for whoever runs the league: the things that
-- have to happen before Sunday, kept next to the controls that do them. It
-- started in localStorage, which meant it lived in one browser on one machine
-- and vanished with the site data. A list you cannot trust to still be there is
-- not a list, so it is a table.
--
-- NOTHING IS EVER DELETED
-- The X on a row, and emptying a line, both archive it: the row stays where it
-- is and stops being listed. A to do list is a record of what a season took as
-- much as a list of what is left, and a misfired click on a small button should
-- not be able to destroy either. So the browser has no DELETE on this table at
-- all - clearing an archived row out for good is a deliberate act in the SQL
-- editor.
--
-- WHO CAN SEE IT
-- The admin, and nobody else. Not because there is anything sensitive in it -
-- there is not - but because it is one person's working notes and every other
-- member has no use for them and no business editing them.
--
-- Plain table access rather than the SECURITY DEFINER functions the rest of the
-- admin screen uses. Those exist because their tables hold columns some roles
-- must not read, and a function is the only way to be narrower than a
-- column grant. Nothing here is like that: every column is fit for the one
-- role that can reach any of them, so row-level security says the whole rule in
-- three policies and PostgREST does the rest.
--
-- Run in the Supabase SQL editor. Safe to re-run.
-- Depends on public._2026_is_admin(), which the admin migrations create.

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

  if to_regprocedure('public._2026_is_admin()') is null then
    raise exception
      'public._2026_is_admin() is missing. Run the admin migrations first.';
  end if;
end
$guard$;


-- ---------------------------------------------------------------------------
-- The table. created_at is the sort key - newest first, so a line typed while
-- reading the list appears where the eye already is - and it is set by the
-- database rather than the browser, which has no business deciding what time it
-- is.
-- ---------------------------------------------------------------------------
create table if not exists public._2026_admin_todos (
  id          uuid primary key default gen_random_uuid(),
  body        text        not null check (btrim(body) <> ''),
  done        boolean     not null default false,
  archived    boolean     not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Added separately so this file can be re-run over a table that predates the
-- archive.
alter table public._2026_admin_todos
  add column if not exists archived    boolean not null default false,
  add column if not exists archived_at timestamptz;

-- The shape of the only query the page makes: the live rows, what is left to do
-- first, newest first inside each half.
create index if not exists _2026_admin_todos_board_idx
  on public._2026_admin_todos (archived, done, created_at desc);


-- ---------------------------------------------------------------------------
-- updated_at and archived_at are maintained here, not by the browser: a client
-- that forgets to send one, or sends a clock that is wrong, would otherwise
-- leave the column lying. The browser sets archived to true and the database
-- decides what time that was.
-- ---------------------------------------------------------------------------
create or replace function public._2026_admin_todos_touch()
returns trigger
language plpgsql
as $touch$
begin
  new.updated_at := now();

  if new.archived and not old.archived then
    new.archived_at := now();
  elsif not new.archived then
    new.archived_at := null;
  end if;

  return new;
end;
$touch$;

drop trigger if exists _2026_admin_todos_touch_before_update on public._2026_admin_todos;
create trigger _2026_admin_todos_touch_before_update
before update on public._2026_admin_todos
for each row
execute function public._2026_admin_todos_touch();


-- ---------------------------------------------------------------------------
-- One rule, said four times because PostgreSQL wants a policy per verb. Every
-- one of them is the same question: are you the admin?
--
-- with check as well as using on the writes: without it an update could hand a
-- row to somebody else on the way out, and an insert could create one nobody
-- who wrote it can see.
-- ---------------------------------------------------------------------------
alter table public._2026_admin_todos enable row level security;

drop policy if exists _2026_admin_todos_select on public._2026_admin_todos;
create policy _2026_admin_todos_select
  on public._2026_admin_todos for select to authenticated
  using (public._2026_is_admin());

drop policy if exists _2026_admin_todos_insert on public._2026_admin_todos;
create policy _2026_admin_todos_insert
  on public._2026_admin_todos for insert to authenticated
  with check (public._2026_is_admin());

drop policy if exists _2026_admin_todos_update on public._2026_admin_todos;
create policy _2026_admin_todos_update
  on public._2026_admin_todos for update to authenticated
  using (public._2026_is_admin())
  with check (public._2026_is_admin());

-- No delete policy, and no delete grant below. Archiving is an update, so
-- there is nothing the page needs to destroy - and a table nobody can delete
-- from cannot lose a row to a stray click or a bug in a click handler.
drop policy if exists _2026_admin_todos_delete on public._2026_admin_todos;


-- ---------------------------------------------------------------------------
-- Grants. Signed out gets nothing at all - not even the shape of the table.
-- Signed in gets read, add and change, and the policies above then decide that
-- only one signed-in account may actually use them. Delete is granted to
-- nobody: see NOTHING IS EVER DELETED at the top.
-- ---------------------------------------------------------------------------
revoke all on public._2026_admin_todos from anon;
revoke delete on public._2026_admin_todos from authenticated;
grant select, insert, update on public._2026_admin_todos to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. Expect three policies (select, insert, update), RLS on, no DELETE
-- for either browser role, and nothing at all for anon.
-- ---------------------------------------------------------------------------
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = '_2026_admin_todos'
order by policyname;

select relrowsecurity as rls_enabled
from pg_class
where oid = 'public._2026_admin_todos'::regclass;

select grantee, string_agg(privilege_type, ', ' order by privilege_type) as granted
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = '_2026_admin_todos'
  and grantee in ('anon', 'authenticated')
group by grantee
order by grantee;
