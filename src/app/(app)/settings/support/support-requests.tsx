"use client";

import { CheckIcon, LogOutIcon, XIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { decideSupportAction, endSupportAction } from "@/modules/support/actions";
import type { SupportRequest } from "@/modules/support/queries";
import { SUPPORT_DURATIONS, type SupportStatus } from "@/modules/support/schemas";

const TONES: Record<SupportStatus, StatusTone> = {
  pending: "warning",
  approved: "info",
  active: "success",
  rejected: "danger",
  ended: "neutral",
  cancelled: "neutral",
};

export function SupportRequests({ requests }: { requests: SupportRequest[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {requests.map((request) => (
        <SupportRequestItem key={request.id} request={request} />
      ))}
    </ul>
  );
}

function SupportRequestItem({ request }: { request: SupportRequest }) {
  const t = useTranslations("support");
  const format = useFormatter();
  const router = useRouter();
  const [minutes, setMinutes] = useState<(typeof SUPPORT_DURATIONS)[number]>(60);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(t(`errors.${(result.error ?? "unexpected") as "unexpected"}`));
      }
    });

  const open = request.status === "approved" || request.status === "active";

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{request.requesterName}</span>
        <StatusBadge tone={TONES[request.status]}>{t(`status.${request.status}`)}</StatusBadge>
        <span className="ml-auto text-xs text-muted-foreground">
          {format.dateTime(new Date(request.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">{t("reason")}: </span>
        {request.reason}
      </p>
      {open && request.approvedUntil ? (
        <p className="text-sm">
          {t("until", {
            time: format.dateTime(new Date(request.approvedUntil), {
              timeStyle: "short",
              dateStyle: "short",
            }),
          })}
        </p>
      ) : null}
      {request.decisionNote ? (
        <p className="text-sm text-muted-foreground">{request.decisionNote}</p>
      ) : null}

      {request.status === "pending" ? (
        <div className="flex flex-col gap-3">
          {rejecting ? (
            <Field>
              <FieldLabel htmlFor={`support-note-${request.id}`}>{t("rejectNote")}</FieldLabel>
              <Textarea
                id={`support-note-${request.id}`}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          ) : (
            <Field orientation="horizontal" className="w-auto">
              <FieldLabel htmlFor={`support-minutes-${request.id}`}>{t("duration")}</FieldLabel>
              <NativeSelect
                id={`support-minutes-${request.id}`}
                value={String(minutes)}
                onChange={(event) =>
                  setMinutes(Number(event.target.value) as (typeof SUPPORT_DURATIONS)[number])
                }
              >
                {SUPPORT_DURATIONS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {t("minutes", { minutes: value })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {rejecting ? (
              <>
                <Button variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        decideSupportAction({
                          requestId: request.id,
                          approve: false,
                          minutes: null,
                          note,
                        }),
                      t("rejectedToast"),
                    )
                  }
                >
                  <XIcon />
                  {t("reject")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
                  <XIcon />
                  {t("reject")}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        decideSupportAction({
                          requestId: request.id,
                          approve: true,
                          minutes,
                          note: "",
                        }),
                      t("approvedToast"),
                    )
                  }
                >
                  <CheckIcon />
                  {t("approve")}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : open ? (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => endSupportAction(request.id), t("endedToast"))}
          >
            <LogOutIcon />
            {t("endNow")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
