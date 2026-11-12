-- Speed (D-062). The notification bell, the "?" button and the support prompt
-- asked the server every 30 s (10 s for the support prompt) for every signed-in
-- user. Realtime now tells the browser when one of the tables behind them
-- changes, and the browser reloads its notifications then; polling remains as
-- a slow fallback.
--
-- Postgres Changes delivers a row only to subscribers whose RLS select policy
-- allows it, so nobody learns of rows they cannot read. The browser uses the
-- event only as a signal and reloads through /api/notifications.

alter publication supabase_realtime add table
  public.production_order_close_requests,
  public.attendance_alerts,
  public.absences,
  public.attendance_corrections,
  public.support_access_requests,
  public.problem_report_messages;
