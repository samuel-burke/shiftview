-- A fingerprint of the public schema: one row per kind of object (policies,
-- functions and their privileges, columns, column grants, constraints,
-- triggers, RLS flags, Realtime tables) with a count and an md5 of them all.
-- Read-only. Run it against production (Supabase SQL editor) and against a
-- database built from supabase/migrations, and compare:
-- matching rows mean the repository builds what production runs.
--
-- Function bodies are compared with whitespace collapsed and -- comments
-- removed, because the SQL editor stores bodies with CRLF line endings and
-- some were applied without their comments.

with l as (select regexp_replace(kind || ' | ' || name || ' | ' || detail, '\s+', ' ', 'g') as line from (
  select 'policy' kind, schemaname||'.'||tablename||'.'||policyname name,
         cmd||' '||array_to_string(roles,',')||' using:'||coalesce(qual,'')||' check:'||coalesce(with_check,'') detail
  from pg_policies where schemaname='public'
  union all
  select 'function', p.oid::regprocedure::text,
         (case when p.prosecdef then 'definer' else 'invoker' end)||' acl:'||coalesce(array_to_string(array(select unnest(p.proacl)::text order by 1),','),'default')||' md5:'||md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all
  select 'column', table_name||'.'||column_name, data_type||' null:'||is_nullable||' def:'||coalesce(column_default,'')
  from information_schema.columns where table_schema='public'
  union all
  select 'colgrant', table_name||'.'||column_name||'.'||grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated')
  group by table_name, column_name, grantee
  union all
  select 'constraint', conrelid::regclass::text||'.'||conname, pg_get_constraintdef(oid)
  from pg_constraint where connamespace='public'::regnamespace
  union all
  select 'trigger', tgrelid::regclass::text||'.'||tgname, pg_get_triggerdef(oid)
  from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%.%'
  union all
  select 'rls', relname, relrowsecurity::text||' force:'||relforcerowsecurity::text
  from pg_class where relnamespace='public'::regnamespace and relkind='r'
  union all
  select 'realtime', schemaname||'.'||tablename, '' from pg_publication_tables where pubname='supabase_realtime'
) x) select split_part(line,' | ',1) kind, count(*), md5(string_agg(line, E'\n' order by line)) from l group by 1 order by 1;
