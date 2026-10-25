"use client";

import { CheckCheckIcon, ClipboardPenIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { addDecimals, formatDecimal, parseDecimal } from "@/lib/decimal";
import { formatLocalDateTime } from "@/lib/format";
import { utcToZonedLocal } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  pauseWorkAction,
  reportQuantityAction,
  requestCloseAction,
  startWorkAction,
} from "@/modules/production-reporting/actions";
import type { OperationWork, Reason } from "@/modules/production-reporting/queries";
import {
  hasShortage,
  remainingQuantity,
  reportProblem,
  unreportedOnFinish,
  workButtons,
} from "@/modules/production-reporting/rules";
import type { WorkActionResult } from "@/modules/production-reporting/schemas";
import type { OperationStatus } from "@/modules/production-orders/status-rules";

type Props = {
  operationId: string;
  orderId: string;
  orderNumber: string;
  orderQuantity: string;
  operationStatus: OperationStatus;
  isInspection: boolean;
  unitLabel: string;
  wholePieces: boolean;
  timezone: string;
  work: OperationWork;
  downtimeReasons: Reason[];
  scrapReasons: Reason[];
};

/**
 * The worker's buttons on one operation: start / continue, pause with a
 * reason, report good and scrap in parts, finish. Inspectors use the same
 * panel for inspections and may ask to close an order with a shortage.
 */
export function WorkPanel(props: Props) {
  const { work, operationStatus, isInspection } = props;
  const t = useTranslations("floorWork");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheet, setSheet] = useState<"pause" | "report" | "finish" | "close" | null>(null);
  const buttons = workButtons({ blocked: work.blocked, working: work.working, operationStatus });

  const run = (action: () => Promise<WorkActionResult>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        setSheet(null);
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  const shortage = hasShortage(work.order_good_quantity, props.orderQuantity);
  const showClose =
    work.can_request_close && work.is_last && operationStatus === "done" && shortage;

  return (
    <Card data-testid="work-panel">
      <CardHeader>
        <CardTitle className="text-base">
          {isInspection ? t("inspectionTitle") : t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2 text-center">
          <Figure label={t("arrived")} value={work.input_quantity} unit={props.unitLabel} />
          <Figure
            label={t("remaining")}
            value={work.remaining_quantity}
            unit={props.unitLabel}
            strong
          />
          <Figure
            label={isInspection ? t("goodInspected") : t("good")}
            value={work.good_quantity}
            unit={props.unitLabel}
            tone="good"
          />
          <Figure
            label={t("scrap")}
            value={work.scrap_quantity}
            unit={props.unitLabel}
            tone="bad"
          />
        </dl>

        {work.workers_now.length > 0 ? (
          <p className="text-sm" data-testid="workers-now">
            {t("workingNow", { names: work.workers_now.join(", ") })}
          </p>
        ) : null}
        {work.pause ? (
          <Alert>
            <PauseIcon />
            <AlertTitle>{t("pausedTitle", { reason: work.pause.reason })}</AlertTitle>
            <AlertDescription>
              {t("pausedSince", {
                time: formatLocalDateTime(utcToZonedLocal(work.pause.since, props.timezone)),
              })}
              {work.pause.notes ? ` · ${work.pause.notes}` : ""}
            </AlertDescription>
          </Alert>
        ) : null}
        {work.blocked && work.blocked !== "operation_done" ? (
          <p className="rounded-lg bg-muted p-3 text-sm" data-testid="work-blocked">
            {t(`blocked.${work.blocked}`)}
          </p>
        ) : null}

        <div className="grid gap-2">
          {buttons.start ? (
            <Button
              className="h-14 text-lg"
              disabled={pending}
              onClick={() =>
                run(
                  () => startWorkAction(props.operationId),
                  t("startedToast", { number: props.orderNumber }),
                )
              }
            >
              <PlayIcon />
              {operationStatus === "paused" || operationStatus === "in_progress"
                ? t("continue")
                : isInspection
                  ? t("startInspection")
                  : t("start")}
            </Button>
          ) : null}
          {buttons.report ? (
            <Button
              variant="outline"
              className="h-14 text-lg"
              disabled={pending}
              onClick={() => setSheet("report")}
            >
              <ClipboardPenIcon />
              {t("report")}
            </Button>
          ) : null}
          {buttons.pause ? (
            <Button
              variant="outline"
              className="h-14 text-lg"
              disabled={pending}
              onClick={() => setSheet("pause")}
            >
              <PauseIcon />
              {t("pause")}
            </Button>
          ) : null}
          {buttons.finish ? (
            <Button
              variant="secondary"
              className="h-14 text-lg"
              disabled={pending}
              onClick={() => setSheet("finish")}
            >
              <CheckCheckIcon />
              {isInspection ? t("finishInspection") : t("finish")}
            </Button>
          ) : null}
        </div>

        {operationStatus === "done" ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {t("doneNote")}
          </p>
        ) : null}
        {work.close_request ? (
          <p className="rounded-lg bg-muted p-3 text-sm" data-testid="close-request-state">
            {t(`closeRequest.${work.close_request.status}`)}
            {work.close_request.decision_note ? ` · ${work.close_request.decision_note}` : ""}
          </p>
        ) : null}
        {showClose ? (
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => setSheet("close")}
            disabled={pending}
          >
            {t("requestClose")}
          </Button>
        ) : null}
      </CardContent>

      <PauseSheet
        open={sheet === "pause"}
        onOpenChange={(open) => setSheet(open ? "pause" : null)}
        reasons={props.downtimeReasons}
        pending={pending}
        onSubmit={(reasonId, notes) =>
          run(() => pauseWorkAction(props.operationId, { reasonId, notes }), t("pausedToast"))
        }
      />
      <ReportSheet
        key={sheet === "finish" ? "finish" : "report"}
        open={sheet === "report" || sheet === "finish"}
        finish={sheet === "finish"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        work={work}
        isInspection={isInspection}
        isLast={work.is_last}
        orderQuantity={props.orderQuantity}
        unitLabel={props.unitLabel}
        wholePieces={props.wholePieces}
        scrapReasons={props.scrapReasons}
        pending={pending}
        onSubmit={(input) =>
          run(
            () => reportQuantityAction(props.operationId, input),
            input.finish ? t("finishedToast") : t("reportedToast"),
          )
        }
      />
      <CloseSheet
        open={sheet === "close"}
        onOpenChange={(open) => setSheet(open ? "close" : null)}
        pending={pending}
        good={work.order_good_quantity}
        quantity={props.orderQuantity}
        unitLabel={props.unitLabel}
        onSubmit={(reason) =>
          run(
            () => requestCloseAction(props.orderId, { reason }),
            t("closeRequestedToast", { number: props.orderNumber }),
          )
        }
      />
    </Card>
  );
}

function Figure({
  label,
  value,
  unit,
  strong,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  strong?: boolean;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-xl font-semibold tabular-nums",
          strong && "text-2xl",
          tone === "good" && "text-emerald-700 dark:text-emerald-300",
          tone === "bad" && value !== "0" && "text-destructive",
        )}
      >
        {formatDecimal(value)} <span className="text-sm font-normal">{unit}</span>
      </dd>
    </div>
  );
}

function PauseSheet({
  open,
  onOpenChange,
  reasons,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reasons: Reason[];
  pending: boolean;
  onSubmit: (reasonId: string, notes: string) => void;
}) {
  const t = useTranslations("floorWork");
  const [reasonId, setReasonId] = useState("");
  const [notes, setNotes] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>{t("pauseTitle")}</SheetTitle>
          <SheetDescription>{t("pauseDescription")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <div role="radiogroup" aria-label={t("pauseReason")} className="grid grid-cols-2 gap-2">
            {reasons.map((reason) => (
              <Button
                key={reason.id}
                type="button"
                role="radio"
                aria-checked={reasonId === reason.id}
                variant={reasonId === reason.id ? "default" : "outline"}
                className="h-auto min-h-12 text-base whitespace-normal"
                onClick={() => {
                  setReasonId(reason.id);
                  setInvalid(false);
                }}
              >
                {reason.name}
              </Button>
            ))}
          </div>
          {reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noReasons")}</p>
          ) : null}
          {invalid ? (
            <p className="mt-2 text-sm text-destructive">{t("pauseReasonRequired")}</p>
          ) : null}
          <Field className="mt-4">
            <FieldLabel htmlFor="pause-notes">{t("note")}</FieldLabel>
            <Textarea
              id="pause-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </div>
        <SheetFooter className="border-t">
          <Button
            className="h-12 text-base"
            disabled={pending}
            onClick={() => {
              if (!reasonId) {
                setInvalid(true);
                return;
              }
              onSubmit(reasonId, notes);
            }}
          >
            {t("pauseConfirm")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

type ReportSubmit = {
  good: string;
  scrap: string;
  scrapReasonId: string;
  notes: string;
  idempotencyKey: string;
  finish: boolean;
};

function ReportSheet({
  open,
  finish,
  onOpenChange,
  work,
  isInspection,
  isLast,
  orderQuantity,
  unitLabel,
  wholePieces,
  scrapReasons,
  pending,
  onSubmit,
}: {
  open: boolean;
  finish: boolean;
  onOpenChange: (open: boolean) => void;
  work: OperationWork;
  isInspection: boolean;
  isLast: boolean;
  orderQuantity: string;
  unitLabel: string;
  wholePieces: boolean;
  scrapReasons: Reason[];
  pending: boolean;
  onSubmit: (input: ReportSubmit) => void;
}) {
  const t = useTranslations("floorWork");
  const remaining = remainingQuantity(work.input_quantity, work.good_quantity, work.scrap_quantity);
  // Finishing suggests the rest as good pieces; a part report starts empty.
  const [good, setGood] = useState(finish ? formatDecimal(remaining) : "");
  const [scrap, setScrap] = useState("");
  const [scrapReasonId, setScrapReasonId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const parse = (value: string) => (value.trim() === "" ? "0" : parseDecimal(value, 3));
  const goodValue = parse(good);
  const scrapValue = parse(scrap);
  const valid =
    goodValue !== null &&
    scrapValue !== null &&
    !goodValue.startsWith("-") &&
    !scrapValue.startsWith("-");
  const check = valid
    ? {
        input: work.input_quantity,
        reportedGood: work.good_quantity,
        reportedScrap: work.scrap_quantity,
        good: goodValue,
        scrap: scrapValue,
        wholePieces,
      }
    : null;
  const left = check && finish ? unreportedOnFinish(check) : "0";
  // The last operation decides the order: fewer good pieces than ordered
  // leave it waiting for an approved close.
  const shortAfter =
    isLast && finish && check !== null
      ? hasShortage(addDecimals([work.good_quantity, check.good], 3), orderQuantity)
      : false;

  const submit = () => {
    if (!check) {
      setError(t("errors.invalid"));
      return;
    }
    const problem = reportProblem({ ...check, finish });
    if (problem) {
      setError(t(`errors.${problem}`));
      return;
    }
    onSubmit({
      good: check.good,
      scrap: check.scrap,
      scrapReasonId: scrapValue !== "0" ? scrapReasonId : "",
      notes,
      idempotencyKey: key,
      finish,
    });
    setKey(crypto.randomUUID());
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>
            {finish ? (isInspection ? t("finishInspection") : t("finishTitle")) : t("reportTitle")}
          </SheetTitle>
          <SheetDescription>
            {t("reportDescription", {
              remaining: formatDecimal(remaining),
              unit: unitLabel,
            })}
          </SheetDescription>
        </SheetHeader>
        <form
          id="report-form"
          className="flex-1 overflow-y-auto p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="report-good">{t("goodInput")}</FieldLabel>
                <Input
                  id="report-good"
                  inputMode={wholePieces ? "numeric" : "decimal"}
                  autoComplete="off"
                  className="h-14 text-2xl tabular-nums"
                  value={good}
                  onChange={(event) => {
                    setGood(event.target.value);
                    setError(null);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="report-scrap">{t("scrapInput")}</FieldLabel>
                <Input
                  id="report-scrap"
                  inputMode={wholePieces ? "numeric" : "decimal"}
                  autoComplete="off"
                  className="h-14 text-2xl tabular-nums"
                  value={scrap}
                  onChange={(event) => {
                    setScrap(event.target.value);
                    setError(null);
                  }}
                />
              </Field>
            </div>
            {scrapValue !== null && scrapValue !== "0" ? (
              <Field>
                <FieldLabel htmlFor="report-scrap-reason">{t("scrapReason")}</FieldLabel>
                <NativeSelect
                  id="report-scrap-reason"
                  className="h-12 w-full text-base"
                  value={scrapReasonId}
                  onChange={(event) => setScrapReasonId(event.target.value)}
                >
                  <NativeSelectOption value="">{t("scrapReasonNone")}</NativeSelectOption>
                  {scrapReasons.map((reason) => (
                    <NativeSelectOption key={reason.id} value={reason.id}>
                      {reason.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>{t("scrapReasonHint")}</FieldDescription>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="report-notes">{t("note")}</FieldLabel>
              <Textarea
                id="report-notes"
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            {finish && left !== "0" ? (
              <Alert>
                <AlertDescription>
                  {t("finishLeftover", { count: formatDecimal(left), unit: unitLabel })}
                </AlertDescription>
              </Alert>
            ) : null}
            {shortAfter ? (
              <Alert>
                <AlertDescription>{t("finishShortage")}</AlertDescription>
              </Alert>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="report-form" className="h-12 text-base" disabled={pending}>
            {finish ? t("finishConfirm") : t("reportConfirm")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function CloseSheet({
  open,
  onOpenChange,
  pending,
  good,
  quantity,
  unitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  good: string;
  quantity: string;
  unitLabel: string;
  onSubmit: (reason: string) => void;
}) {
  const t = useTranslations("floorWork");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>{t("closeTitle")}</SheetTitle>
          <SheetDescription>
            {t("closeDescription", {
              good: formatDecimal(good),
              quantity: formatDecimal(quantity),
              unit: unitLabel,
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="close-reason">{t("closeReason")}</FieldLabel>
            <Textarea
              id="close-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid || undefined}
            />
            {invalid ? <FieldError>{t("closeReasonRequired")}</FieldError> : null}
          </Field>
        </div>
        <SheetFooter className="border-t">
          <Button
            className="h-12 text-base"
            disabled={pending}
            onClick={() => {
              if (reason.trim() === "") {
                setInvalid(true);
                return;
              }
              onSubmit(reason.trim());
            }}
          >
            {t("closeConfirm")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
