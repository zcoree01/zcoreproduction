-- Fix (follow-up of 20261027230000): CHECK constraints and triggers on tenant
-- tables call private helper functions (valid_order_number_template,
-- valid_int_list, …). Most were revoked from public, so direct writes by the
-- service role (scripts, tests, the cleanup of a failed registration) failed
-- with "permission denied". The service role bypasses RLS anyway and only
-- runs in trusted server code, so it may execute every private function,
-- also future ones (D-026).
grant execute on all functions in schema private to service_role;

alter default privileges in schema private grant execute on functions to service_role;
