"use client";

import { useEffect } from "react";
import { REPORT_NOTICES_CHANGED_EVENT } from "@/components/shared/problem-report/events";
import { createClient } from "@/lib/supabase/client";
import { setNotificationsLive } from "@/modules/notifications/feed-client";

/** Tables behind the notification feed (migration 20261112200000_notification_realtime). */
const TABLES = [
  "production_order_close_requests",
  "attendance_alerts",
  "absences",
  "attendance_corrections",
  "support_access_requests",
  "problem_report_messages",
] as const;

/** Several changes in a row (one action writes several rows) give one reload. */
const SETTLE_MS = 400;

/**
 * Realtime for the notification bell, the "?" button and the support prompt
 * (D-062): when a row behind them changes in the member's organization, they
 * reload their items at once; their polling then runs only every 5 minutes.
 * Supabase delivers only rows the member may read (RLS); the event itself is
 * only a signal, the items come from /api/notifications.
 */
export function NotificationLive({ organizationId }: { organizationId: string }) {
  useEffect(() => {
    const supabase = createClient();
    let timer: number | undefined;
    const changed = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => window.dispatchEvent(new Event(REPORT_NOTICES_CHANGED_EVENT)),
        SETTLE_MS,
      );
    };
    const channel = supabase.channel(`notifications:${organizationId}`);
    for (const table of TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `organization_id=eq.${organizationId}` },
        changed,
      );
    }
    let cancelled = false;
    void (async () => {
      // Realtime checks RLS with the signed-in user's token.
      await supabase.auth.getSession();
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel.subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        setNotificationsLive(connected);
        // Reconnected: catch up on what changed meanwhile.
        if (connected) changed();
      });
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setNotificationsLive(false);
      void supabase.removeChannel(channel);
    };
  }, [organizationId]);

  return null;
}
