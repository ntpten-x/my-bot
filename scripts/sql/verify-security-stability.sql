-- Read-only post-migration verification. Run only against the explicitly selected database/schema.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT current_database() AS database_name, current_schema() AS schema_name;

-- Expected: every MY-BOT table has rls_enabled=true; review unrelated tables separately.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname=current_schema() AND c.relkind='r'
ORDER BY c.relname;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema=current_schema()
  AND ((table_name='Post' AND column_name='textRevision')
    OR (table_name='AiJob' AND column_name='claimToken'))
ORDER BY table_name;

SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations"
ORDER BY started_at;

-- Counts only: never print post text, credentials, hashes or tokens.
SELECT 'Post' AS table_name, count(*) AS row_count FROM "Post"
UNION ALL SELECT 'Source', count(*) FROM "Source"
UNION ALL SELECT 'AiJob', count(*) FROM "AiJob";
SELECT status, count(*) FROM "AiJob" GROUP BY status ORDER BY status;

-- Supabase roles may be absent on a plain local Postgres. Neither role should bypass RLS.
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
COMMIT;
