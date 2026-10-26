"use client";

import {
  CheckIcon,
  ClipboardCheckIcon,
  FileXIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Duration } from "@/components/shared/duration";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { addDecimals, formatDecimal, parseDecimal } from "@/lib/decimal";
import type { ProductUnit } from "@/modules/products/schemas";
import {
  decideCloseAction,
  recordDowntimeAction,
  requestCloseAction,
  voidReportAction,
} from "@/modules/production-reporting/actions";
import type {
  CloseRequestRow,
  DowntimeRow,
  ProductionReportRow,
  Reason,
  ToolChangeRow,
} from "@/modules/production-reporting/queries";
import {
  downtimeByReason,
  hasShortage,
  orderScrapRatePercent,
} from "@/modules/production-reporting/rules";
import type { WorkActionResult } from "@/modules/production-reporting/schemas";
import type { OrderStatus } from "@/modules/production-orders/status-rules";

type Production = {
  reports: (ProductionReportRow & { reportedLabel: string })[];
  downtime: (DowntimeRow & { startedLabel: string; endedLabel: string | null })[];
  toolChanges: (ToolChangeRow & { changedLabel: string })[];
  closeRequests: (CloseRequestRow & { requestedLabel: string; decidedLabel: string | null })[];
};

const OPEN_FOR_CLOSING: readonly OrderStatus[] = ["in_progress", "paused", "quality_check"];

/**
 * "Proizvodnja" tab: summary (good, scrap and scrap rate, downtime by reason),
 * closing with a shortage (request / approve / reject), reported quantities
 * (void a wrong one), downtime (managers add past downtime) and tool changes.
 */
export function ProductionPanel({
  orderId,
  orderNumber,
  orderStatus,
  quantity,
  goodQuantity,
  unit,
  production,
  can,
  operations,
  downtimeReasons,
}: {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  quantity: string;
  goodQuantity: string;
  unit: ProductUnit;
  production: Production;
  can: { void: boolean; approve: boolean; request: boolean; recordDowntime: boolean };
  /** Operations downtime can be recorded on (not external). */
  operations: { id: string; code: string; name: string }[];
  downtimeReasons: Reason[];
}) {
  const t = useTranslations("orders.production");
  const tUnits = useTranslations("productUnits");
  const [dialog, setDialog] = useState<
    | { kind: "request" }
    | { kind: "reject"; requestId: string }
    | { kind: "void"; report: ProductionReportRow }
    | { kind: "downtime" }
    | null
  >(null);
  // New key and empty form after every confirmed save.
  const [version, setVersion] = useState(0);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const pendingRequest = production.closeRequests.find((row) => row.status === "pending");
  const closable = OPEN_FOR_CLOSING.includes(orderStatus);
  const shortage = hasShortage(goodQuantity, quantity);
  const valid = production.reports.filter((row) => row.voidedAt === null);
  const scrapTotal = addDecimals(
    valid.map((row) => row.scrap),
    3,
  );
  const scrapRate = orderScrapRatePercent(valid);
  const byReason = downtimeByReason(production.downtime);
  const downtimeTotal = addDecimals(
    production.downtime.map((row) => row.seconds),
    3,
  );

  const run = (action: () => Promise<WorkActionResult>, success: string) =>
    startTransition(async () => {
      let result: WorkActionResult;
      try {
        result = await action();
      } catch {
        toast.error(t("errors.network"));
        return;
      }
      if (result.ok) {
        toast.success(success);
        setDialog(null);
        setVersion((current) => current + 1);
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-3 sm:grid-cols-4" data-testid="production-summary">
        <SummaryItem label={t("summary.good")}>
          {formatDecimal(goodQuantity)} / {formatDecimal(quantity)} {tUnits(unit)}
        </SummaryItem>
        <SummaryItem label={t("summary.scrap")}>
          {formatDecimal(scrapTotal)} {tUnits(unit)}
        </SummaryItem>
        <SummaryItem label={t("summary.scrapRate")}>
          {scrapRate === null ? "—" : `${formatDecimal(scrapRate)} %`}
        </SummaryItem>
        <SummaryItem label={t("summary.downtime")}>
          {downtimeTotal === "0" ? "—" : <Duration seconds={downtimeTotal} />}
        </SummaryItem>
      </dl>

      {pendingRequest ? (
        <Alert data-testid="close-request-pending">
          <TriangleAlertIcon />
          <AlertTitle>{t("pendingTitle")}</AlertTitle>
          <AlertDescription>
            {t("pendingDescription", {
              name: pendingRequest.requestedBy ?? "—",
              good: formatDecimal(pendingRequest.good),
              quantity: formatDecimal(quantity),
              unit: tUnits(unit),
              reason: pendingRequest.reason,
            })}
          </AlertDescription>
          {can.approve ? (
            <AlertAction className="flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => decideCloseAction(pendingRequest.id, { approve: true, note: "" }),
                    t("approvedToast", { number: orderNumber }),
                  )
                }
              >
                <CheckIcon />
                {t("approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setDialog({ kind: "reject", requestId: pendingRequest.id })}
              >
                <XIcon />
                {t("reject")}
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : can.request && closable && shortage ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">
            {t("requestHint", {
              good: formatDecimal(goodQuantity),
              quantity: formatDecimal(quantity),
              unit: tUnits(unit),
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "request" })}>
            {t("requestClose")}
          </Button>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("reportsTitle")}</h2>
        {production.reports.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheckIcon />}
            title={t("reportsEmptyTitle")}
            description={t("reportsEmptyDescription")}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.time")}</TableHead>
                  <TableHead>{t("columns.operation")}</TableHead>
                  <TableHead>{t("columns.worker")}</TableHead>
                  <TableHead className="text-right">{t("columns.good")}</TableHead>
                  <TableHead className="text-right">{t("columns.scrap")}</TableHead>
                  <TableHead>{t("columns.note")}</TableHead>
                  {can.void ? (
                    <TableHead>
                      <span className="sr-only">{t("columns.actions")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {production.reports.map((row) => {
                  const voided = row.voidedAt !== null;
                  return (
                    <TableRow key={row.id} className={voided ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-nowrap">{row.reportedLabel}</TableCell>
                      <TableCell>
                        <span className="font-mono">{row.operationCode}</span>
                        {row.machineCode ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · {row.machineCode}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.employeeName ?? row.username ?? "—"}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${voided ? "line-through" : ""}`}
                      >
                        {formatDecimal(row.good)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${voided ? "line-through" : ""}`}
                      >
                        {formatDecimal(row.scrap)}
                      </TableCell>
                      <TableCell className="max-w-64 text-sm">
                        <div className="flex flex-col gap-0.5">
                          {row.scrapReason ? <span>{row.scrapReason}</span> : null}
                          {row.notes ? (
                            <span className="text-muted-foreground">{row.notes}</span>
                          ) : null}
                          {voided ? (
                            <Badge variant="outline" className="w-fit">
                              {t("voided", { reason: row.voidReason ?? "" })}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      {can.void ? (
                        <TableCell className="text-right">
                          {!voided && closable ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("void")}
                              onClick={() => setDialog({ kind: "void", report: row })}
                            >
                              <FileXIcon />
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("downtimeTitle")}</h2>
          {can.recordDowntime && closable && operations.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "downtime" })}>
              <PlusIcon />
              {t("addDowntime")}
            </Button>
          ) : null}
        </div>
        {byReason.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-sm" data-testid="downtime-by-reason">
            {byReason.map((row) => (
              <li key={row.reason} className="rounded-lg border px-3 py-1.5">
                <span className="font-medium">{row.reason}</span>{" "}
                <span className="text-muted-foreground tabular-nums">
                  <Duration seconds={row.seconds} /> · {t("times", { count: row.count })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {production.downtime.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("downtimeEmpty")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.from")}</TableHead>
                  <TableHead>{t("columns.to")}</TableHead>
                  <TableHead>{t("columns.duration")}</TableHead>
                  <TableHead>{t("columns.operation")}</TableHead>
                  <TableHead>{t("columns.reason")}</TableHead>
                  <TableHead>{t("columns.worker")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {production.downtime.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{row.startedLabel}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.endedLabel ?? <Badge variant="secondary">{t("ongoing")}</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Duration seconds={row.seconds} />
                      {row.source === "entry" ? (
                        <Badge variant="outline" className="ml-2">
                          {t("sourceEntry")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">{row.operationCode}</span>
                      {row.machineCode ? (
                        <span className="text-xs text-muted-foreground"> · {row.machineCode}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{row.reason}</span>
                        {row.notes ? (
                          <span className="text-xs text-muted-foreground">{row.notes}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{row.employeeName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("toolChangesTitle")}</h2>
        {production.toolChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("toolChangesEmpty")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.time")}</TableHead>
                  <TableHead>{t("columns.operation")}</TableHead>
                  <TableHead>{t("columns.tool")}</TableHead>
                  <TableHead>{t("columns.reason")}</TableHead>
                  <TableHead>{t("columns.duration")}</TableHead>
                  <TableHead>{t("columns.worker")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {production.toolChanges.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{row.changedLabel}</TableCell>
                    <TableCell>
                      <span className="font-mono">{row.operationCode}</span>
                      {row.machineCode ? (
                        <span className="text-xs text-muted-foreground"> · {row.machineCode}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{row.tool}</span>
                        {row.insert ? (
                          <span className="text-xs text-muted-foreground">{row.insert}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{row.reason}</span>
                        {row.notes ? (
                          <span className="text-xs text-muted-foreground">{row.notes}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.minutes ? `${formatDecimal(row.minutes)} min` : "—"}
                    </TableCell>
                    <TableCell>{row.employeeName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {production.closeRequests.some((row) => row.status !== "pending") ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("closeLogTitle")}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {production.closeRequests
              .filter((row) => row.status !== "pending")
              .map((row) => (
                <li key={row.id} className="rounded-lg border p-3">
                  <p>
                    <Badge variant={row.status === "approved" ? "default" : "outline"}>
                      {t(`closeStatus.${row.status}`)}
                    </Badge>{" "}
                    {t("closeLogLine", {
                      requested: row.requestedBy ?? "—",
                      at: row.requestedLabel,
                      decided: row.decidedBy ?? "—",
                      decidedAt: row.decidedLabel ?? "—",
                    })}
                  </p>
                  <p className="text-muted-foreground">{row.reason}</p>
                  {row.decisionNote ? (
                    <p className="text-muted-foreground">{row.decisionNote}</p>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <DowntimeEntrySheet
        key={`downtime-${version}`}
        open={dialog?.kind === "downtime"}
        onOpenChange={(open) => setDialog(open ? { kind: "downtime" } : null)}
        pending={pending}
        operations={operations}
        reasons={downtimeReasons}
        onSubmit={(operationId, input) =>
          run(() => recordDowntimeAction(operationId, input), t("downtimeSaved"))
        }
      />
      <ReasonSheet
        key={`reason-${version}`}
        open={dialog !== null && dialog.kind !== "downtime"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        pending={pending}
        title={
          dialog?.kind === "request"
            ? t("requestTitle", { number: orderNumber })
            : dialog?.kind === "reject"
              ? t("rejectTitle")
              : t("voidTitle")
        }
        description={
          dialog?.kind === "request"
            ? t("requestDescription")
            : dialog?.kind === "reject"
              ? t("rejectDescription")
              : dialog?.kind === "void"
                ? t("voidDescription", {
                    code: dialog.report.operationCode,
                    good: formatDecimal(dialog.report.good),
                    scrap: formatDecimal(dialog.report.scrap),
                  })
                : ""
        }
        confirmLabel={
          dialog?.kind === "request"
            ? t("requestConfirm")
            : dialog?.kind === "reject"
              ? t("reject")
              : t("void")
        }
        onSubmit={(reason) => {
          if (dialog?.kind === "request") {
            run(
              () => requestCloseAction(orderId, { reason }),
              t("requestedToast", { number: orderNumber }),
            );
          } else if (dialog?.kind === "reject") {
            run(
              () => decideCloseAction(dialog.requestId, { approve: false, note: reason }),
              t("rejectedToast"),
            );
          } else if (dialog?.kind === "void") {
            run(() => voidReportAction(dialog.report.id, { reason }), t("voidedToast"));
          }
        }}
      />
    </div>
  );
}

/** Sheet with one required reason text. */
export function ReasonSheet({
  open,
  onOpenChange,
  pending,
  title,
  description,
  confirmLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onSubmit: (reason: string) => void;
}) {
  const t = useTranslations("orders.production");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          setInvalid(false);
        }
        onOpenChange(next);
      }}
    >
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <form
          id="production-reason-form"
          className="flex-1 overflow-y-auto p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (trimmed.length === 0 || trimmed.length > 500) {
              setInvalid(true);
              return;
            }
            onSubmit(trimmed);
          }}
        >
          <FieldGroup>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="production-reason">{t("reason")}</FieldLabel>
              <Textarea
                id="production-reason"
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={invalid || undefined}
              />
              {invalid ? (
                <FieldError>{t("reasonRequired")}</FieldError>
              ) : (
                <FieldDescription>{t("reasonHint")}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="production-reason-form" disabled={pending}>
            {confirmLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** Managers: downtime that already happened, with operation, start and duration. */
function DowntimeEntrySheet({
  open,
  onOpenChange,
  pending,
  operations,
  reasons,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  operations: { id: string; code: string; name: string }[];
  reasons: Reason[];
  onSubmit: (
    operationId: string,
    input: {
      reasonId: string;
      minutes: string;
      startedAt: string;
      notes: string;
      idempotencyKey: string;
    },
  ) => void;
}) {
  const t = useTranslations("orders.production");
  const [operationId, setOperationId] = useState(operations[0]?.id ?? "");
  const [reasonId, setReasonId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("addDowntimeTitle")}</SheetTitle>
          <SheetDescription>{t("addDowntimeDescription")}</SheetDescription>
        </SheetHeader>
        <form
          id="downtime-entry-form"
          className="flex-1 overflow-y-auto p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseDecimal(minutes, 2);
            if (!reasonId) return setError(t("downtimeReasonRequired"));
            if (!parsed || parsed === "0" || parsed.startsWith("-")) {
              return setError(t("minutesInvalid"));
            }
            onSubmit(operationId, {
              reasonId,
              minutes: parsed,
              startedAt,
              notes,
              idempotencyKey: key,
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="downtime-operation">{t("columns.operation")}</FieldLabel>
              <NativeSelect
                id="downtime-operation"
                className="w-full"
                value={operationId}
                onChange={(event) => setOperationId(event.target.value)}
              >
                {operations.map((op) => (
                  <NativeSelectOption key={op.id} value={op.id}>
                    {`${op.code} · ${op.name}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="downtime-reason">{t("columns.reason")}</FieldLabel>
              <NativeSelect
                id="downtime-reason"
                className="w-full"
                value={reasonId}
                onChange={(event) => {
                  setReasonId(event.target.value);
                  setError(null);
                }}
              >
                <NativeSelectOption value="">{t("chooseReason")}</NativeSelectOption>
                {reasons.map((reason) => (
                  <NativeSelectOption key={reason.id} value={reason.id}>
                    {reason.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="downtime-start">{t("start")}</FieldLabel>
              <Input
                id="downtime-start"
                type="datetime-local"
                value={startedAt}
                onChange={(event) => setStartedAt(event.target.value)}
              />
              <FieldDescription>{t("startHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="downtime-minutes">{t("minutes")}</FieldLabel>
              <Input
                id="downtime-minutes"
                inputMode="decimal"
                autoComplete="off"
                value={minutes}
                onChange={(event) => {
                  setMinutes(event.target.value);
                  setError(null);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="downtime-notes">{t("note")}</FieldLabel>
              <Textarea
                id="downtime-notes"
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="downtime-entry-form" disabled={pending}>
            {t("saveDowntime")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
