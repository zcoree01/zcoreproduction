"use client";

import { ShieldQuestionIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { REPORT_NOTICES_CHANGED_EVENT } from "@/components/shared/problem-report/events";
import { fetchNotificationFeed } from "@/modules/notifications/feed-client";
import { decideSupportAction } from "@/modules/support/actions";
import type { PendingSupportRequest } from "@/modules/support/queries";
import { SUPPORT_DURATIONS } from "@/modules/support/schemas";

const POLL_MS = 10_000;

/**
 * For admins / directors (support.approve, D-028): a Zcore support request
 * opens a dialog in the middle of the screen right away, wherever they are,
 * to approve it for a chosen time or reject it. "Kasnije" hides it until the
 * page is opened again; the request stays in Postavke → Zcore podrška.
 */
export function SupportRequestPrompt() {
  const t = useTranslations("support.prompt");
  const tSupport = useTranslations("support");
  const format = useFormatter();
  const pathname = usePathname();
  const [requests, setRequests] = useState<PendingSupportRequest[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [minutes, setMinutes] = useState<(typeof SUPPORT_DURATIONS)[number]>(60);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    // first: shared with the other header components; poll: skipped while
    // Realtime is connected; fresh: after a change.
    const refresh = async (mode: "first" | "poll" | "fresh") => {
      const feed = await fetchNotificationFeed({
        fresh: mode === "fresh",
        poll: mode === "poll",
      });
      if (active && feed) setRequests(feed.supportRequests);
    };
    const poll = () => void refresh("poll");
    const changed = () => void refresh("fresh");
    void refresh("first");
    const timer = window.setInterval(poll, POLL_MS);
    window.addEventListener("focus", poll);
    // Realtime (NotificationLive) announces a new request at once.
    window.addEventListener(REPORT_NOTICES_CHANGED_EVENT, changed);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
      window.removeEventListener(REPORT_NOTICES_CHANGED_EVENT, changed);
    };
  }, [pathname]);

  const current = requests.find((request) => !dismissed.has(request.id)) ?? null;
  // A session Zcore proposed from a report: fixed start and duration, no choice.
  const scheduled = current?.scheduledStart != null && current.durationMinutes != null;

  const decide = (approve: boolean) => {
    if (!current) return;
    startTransition(async () => {
      const result = await decideSupportAction({
        requestId: current.id,
        approve,
        minutes: approve && !scheduled ? minutes : null,
        note: approve ? "" : note,
        scheduled,
      });
      if (result.ok) {
        toast.success(
          approve
            ? scheduled
              ? tSupport("scheduledApprovedToast")
              : t("approvedToast", { minutes })
            : tSupport("rejectedToast"),
        );
        setRequests((list) => list.filter((request) => request.id !== current.id));
        setRejecting(false);
        setNote("");
      } else {
        toast.error(tSupport(`errors.${result.error}`));
      }
    });
  };

  return (
    <AlertDialog
      open={current !== null}
      onOpenChange={(open) => {
        if (!open && current) setDismissed((ids) => new Set([...ids, current.id]));
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ShieldQuestionIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(scheduled ? "scheduledDescription" : "description", {
              name: current?.requesterName ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          <p className="rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">{tSupport("reason")}: </span>
            {current?.reason}
          </p>
          {rejecting ? (
            <Field>
              <FieldLabel htmlFor="support-prompt-note">{tSupport("rejectNote")}</FieldLabel>
              <Textarea
                id="support-prompt-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          ) : current && scheduled ? (
            <p
              className="rounded-lg border bg-muted/40 p-3 text-sm"
              data-testid="support-scheduled"
            >
              {tSupport("scheduledWindow", {
                start: format.dateTime(new Date(current.scheduledStart ?? 0), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
                minutes: current.durationMinutes ?? 0,
              })}
            </p>
          ) : (
            <Field>
              <FieldLabel htmlFor="support-prompt-minutes">{tSupport("duration")}</FieldLabel>
              <NativeSelect
                id="support-prompt-minutes"
                className="w-full"
                value={String(minutes)}
                onChange={(event) =>
                  setMinutes(Number(event.target.value) as (typeof SUPPORT_DURATIONS)[number])
                }
              >
                {SUPPORT_DURATIONS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {tSupport("minutes", { minutes: value })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
        <AlertDialogFooter>
          {rejecting ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
                {tSupport("cancel")}
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => decide(false)}>
                {tSupport("reject")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => current && setDismissed((ids) => new Set([...ids, current.id]))}
              >
                {t("later")}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
                {tSupport("reject")}
              </Button>
              <Button disabled={pending} onClick={() => decide(true)}>
                {tSupport("approve")}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
