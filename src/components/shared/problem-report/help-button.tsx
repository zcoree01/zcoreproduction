"use client";

import { CircleHelpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { markNotificationsAction, notificationStateAction } from "@/modules/notifications/actions";
import type { NotificationState } from "@/modules/notifications/rules";
import { reportNoticesAction } from "@/modules/support/problem-reports/actions";
import type { ReportNotice } from "@/modules/support/problem-reports/types";
import { OPEN_MY_REPORTS_EVENT, REPORT_NOTICES_CHANGED_EVENT } from "./events";
import { MyReports } from "./my-reports";
import { newReportDraft, ReportSheet, type ReportDraft } from "./report-sheet";

const POLL_MS = 30_000;

/**
 * "?" in the top bar (management app next to the bell, floor header): opens a
 * full-screen sheet on a phone with "Prijavi problem" and "Moje prijave". A
 * dot shows while a Zcore reply (or the decision on a proposed support
 * session) is unread; opening the conversation marks it read. Not rendered in
 * the Zcore organization (the layouts decide).
 */
export function HelpButton({ size = "icon" }: { size?: "icon" | "icon-lg" }) {
  const t = useTranslations("problemReports");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "mine">("new");
  const [draft, setDraft] = useState<ReportDraft>(newReportDraft);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notices, setNotices] = useState<ReportNotice[]>([]);
  const [state, setState] = useState<NotificationState>({ read: [], dismissed: [] });
  // Latest values for markRead, which must keep a stable identity.
  const stateRef = useRef(state);
  const noticesRef = useRef(notices);
  useEffect(() => {
    stateRef.current = state;
    noticesRef.current = notices;
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [nextNotices, nextState] = await Promise.all([
          reportNoticesAction(),
          notificationStateAction(),
        ]);
        if (!active) return;
        setNotices(nextNotices);
        setState(nextState);
      } catch {
        // Offline or signed out: keep what is shown; the next poll retries.
      }
    };
    const openMine = () => {
      setTab("mine");
      setOpen(true);
      setRefreshKey((key) => key + 1);
    };
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(REPORT_NOTICES_CHANGED_EVENT, refresh);
    window.addEventListener(OPEN_MY_REPORTS_EVENT, openMine);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(REPORT_NOTICES_CHANGED_EVENT, refresh);
      window.removeEventListener(OPEN_MY_REPORTS_EVENT, openMine);
    };
  }, []);

  const unread = notices.some(
    (notice) => !state.read.includes(notice.key) && !state.dismissed.includes(notice.key),
  );

  /** The conversation of a report was shown: its notices are read. */
  const markRead = useCallback((reportId: string) => {
    const keys = noticesRef.current
      .filter(
        (notice) => notice.reportId === reportId && !stateRef.current.read.includes(notice.key),
      )
      .map((notice) => notice.key);
    if (keys.length === 0) return;
    setState((current) => ({ ...current, read: [...new Set([...current.read, ...keys])] }));
    void markNotificationsAction(keys, false)
      .then(() => window.dispatchEvent(new Event(REPORT_NOTICES_CHANGED_EVENT)))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className="relative"
        aria-label={t("button")}
        title={t("button")}
        data-testid="help-button"
        onClick={() => {
          setOpen(true);
          window.dispatchEvent(new Event(REPORT_NOTICES_CHANGED_EVENT));
        }}
      >
        <CircleHelpIcon />
        {unread ? (
          <span
            data-testid="help-unread-dot"
            aria-hidden
            className="absolute top-1 right-1 size-2.5 rounded-full bg-destructive ring-2 ring-background"
          />
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>{t("button")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value === "mine" ? "mine" : "new")}
            className="min-h-0 flex-1 px-4 pb-4"
          >
            <TabsList className="w-full" aria-label={t("button")}>
              <TabsTrigger value="new" className="h-9 text-sm">
                {t("tabNew")}
              </TabsTrigger>
              <TabsTrigger value="mine" className="h-9 text-sm">
                {t("tabMine")}
                {unread ? (
                  <span aria-hidden className="size-2 rounded-full bg-destructive" />
                ) : null}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="min-h-0 flex-1 overflow-y-auto pt-2">
              <ReportSheet
                draft={draft}
                onChange={setDraft}
                onSent={() => {
                  setRefreshKey((key) => key + 1);
                  setTab("mine");
                }}
              />
            </TabsContent>
            <TabsContent value="mine" className="min-h-0 flex-1 overflow-y-auto pt-2">
              <MyReports
                refreshKey={refreshKey}
                onOpened={markRead}
                onChanged={() => setRefreshKey((key) => key + 1)}
              />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
