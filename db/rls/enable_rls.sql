-- Charlotte Esthy — OPTIONAL defence-in-depth: PostgreSQL Row Level Security (RLS)
--
-- By default tenant isolation is enforced in the server data layer: every query is
-- scoped by the business_id of the authenticated session (src/lib/auth.ts, src/lib/api.ts)
-- and covered by automated tests. This file adds a second, database-level barrier.
--
-- HOW TO USE (not enabled automatically):
--   1. Apply this file once:   psql "$DATABASE_URL" -f db/rls/enable_rls.sql
--   2. Connect the app as a NON-superuser role that is a member of `ce_app`
--      (superusers always bypass RLS):
--          CREATE ROLE ce_login LOGIN PASSWORD '...' IN ROLE ce_app;
--   3. Wrap each request's queries in a transaction that first runs
--          select set_config('app.business_id', '<business uuid>', true);
--      (this requires a small change to src/db/index.ts — see README "Row Level Security").
--
-- With the setting missing, policies match no rows (fail closed).
-- Global tables (users, sessions, password_resets) are not business-owned and are not covered.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ce_app') THEN
    CREATE ROLE ce_app NOLOGIN;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_business_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.business_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_settings', 'memberships', 'categories', 'products', 'customers', 'sales',
    'sale_items', 'payments', 'inventory_movements', 'refunds', 'audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (business_id = app_business_id()) WITH CHECK (business_id = app_business_id())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ce_app', t);
  END LOOP;
END $$;

-- businesses: a session may only see/update its own business row.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON businesses;
CREATE POLICY tenant_isolation ON businesses
  USING (id = app_business_id()) WITH CHECK (id = app_business_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON businesses TO ce_app;

-- refund_items has no business_id: isolate through its parent refund (which is itself protected).
ALTER TABLE refund_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refund_items;
CREATE POLICY tenant_isolation ON refund_items
  USING (EXISTS (SELECT 1 FROM refunds r WHERE r.id = refund_items.refund_id))
  WITH CHECK (EXISTS (SELECT 1 FROM refunds r WHERE r.id = refund_items.refund_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON refund_items TO ce_app;

-- Global identity/session tables are accessed by the server only. Handoff tickets are user-scoped,
-- stored by hash and have a 3-minute expiry / one-use constraint in the application layer.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, password_resets TO ce_app;
