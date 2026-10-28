"use client";

import { LogInIcon, LogOutIcon, ShieldQuestionIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  endSupportAction,
  enterSupportAction,
  requestSupportAction,
} from "@/modules/support/actions";
import type { SupportRequest } from "@/modules/support/queries";

/**
 * Support access to one organization: ask (with a reason), wait for the
 * organization's approval, enter, end.
 */
export function SupportControl({
  organizationId,
  request,
}: {
  organizationId: string;
  request: SupportRequest | null;
}) {
  const t = useTranslations("platform.support");
  const format = useFormatter();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const status = request?.status;
  const open = status === "pending" || status === "approved" || status === "active";

  // While the organization decides, refresh to show its answer at once (D-028).
  useEffect(() => {
    if (status !== "pending") return;
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [status, router]);
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === "pending" && status === "approved") toast.success(t("approvedToast"));
    if (previous.current === "pending" && status === "rejected") toast.error(t("rejectedToast"));
    previous.current = status;
  }, [status, t]);

  const done = (result: { ok: boolean; error?: string }, success: string) => {
    if (result.ok) {
      toast.success(success);
      router.refresh();
    } else {
      toast.error(t(`errors.${(result.error ?? "unexpected") as "unexpected"}`));
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("title")}</span>
        {request && open ? (
          <StatusBadge tone={status === "pending" ? "warning" : "success"}>
            {status === "pending"
              ? t("pending")
              : t("approvedUntil", {
                  time: format.dateTime(new Date(request.approvedUntil ?? request.createdAt), {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                })}
          </StatusBadge>
        ) : request?.status === "rejected" ? (
          <StatusBadge tone="danger">{t("rejected")}</StatusBadge>
        ) : null}
        <div className="ml-auto flex gap-2">
          {status === "approved" || status === "active" ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await enterSupportAction(request?.id);
                  if (result.ok) window.location.assign(result.url);
                  else done(result, "");
                })
              }
            >
              <LogInIcon />
              {t("enter")}
            </Button>
          ) : null}
          {open && request ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  done(await endSupportAction(request.id), t("endedToast")),
                )
              }
            >
              <LogOutIcon />
              {status === "pending" ? t("cancel") : t("end")}
            </Button>
          ) : null}
          {!open && !asking ? (
            <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
              <ShieldQuestionIcon />
              {t("ask")}
            </Button>
          ) : null}
        </div>
      </div>
      {request?.status === "rejected" && request.decisionNote ? (
        <p className="text-sm text-muted-foreground">{request.decisionNote}</p>
      ) : null}
      {asking && !open ? (
        <div className="flex flex-col gap-2">
          <Field>
            <FieldLabel htmlFor={`support-reason-${organizationId}`}>{t("reason")}</FieldLabel>
            <Textarea
              id={`support-reason-${organizationId}`}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={pending}>
              {t("cancelAsk")}
            </Button>
            <Button
              size="sm"
              disabled={pending || reason.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await requestSupportAction({ organizationId, reason });
                  if (result.ok) {
                    setAsking(false);
                    setReason("");
                  }
                  done(result, t("askedToast"));
                })
              }
            >
              {t("send")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
