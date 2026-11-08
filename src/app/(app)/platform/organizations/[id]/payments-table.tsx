"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDecimal } from "@/lib/decimal";
import { setPaymentAction } from "@/modules/platform/billing-actions";
import type { BillingMonth } from "@/modules/platform/billing-queries";

const TONES = { paid: "success", pending: "warning", unpaid: "danger" } as const;

/** Months from the first package up to now, newest first: mark paid / cancel. */
export function PaymentsTable({
  organizationId,
  months,
  today,
}: {
  organizationId: string;
  months: BillingMonth[];
  /** Today in the organization's timezone (default payment day). */
  today: string;
}) {
  const t = useTranslations("platform.billing.payments");
  const tb = useTranslations("platform.billing");
  const tErrors = useTranslations("platform.billing.errors");
  const format = useFormatter();
  const [paying, setPaying] = useState<BillingMonth | null>(null);
  const [cancelling, setCancelling] = useState<BillingMonth | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const day = (value: string) => new Date(`${value}T12:00:00Z`);
  const monthLabel = (period: string) =>
    format.dateTime(day(period), { month: "long", year: "numeric" });
  const dateLabel = (value: string) => format.dateTime(day(value), { dateStyle: "medium" });

  const save = (month: BillingMonth, paid: boolean) =>
    startTransition(async () => {
      const result = await setPaymentAction({
        organizationId,
        period: month.period,
        paid,
        paidOn: paid ? paidOn : "",
        note: paid ? note : "",
      });
      if (result.ok) {
        toast.success(
          paid ? t("paidToast", { month: monthLabel(month.period) }) : t("cancelledToast"),
        );
        setPaying(null);
        setCancelling(null);
      } else {
        toast.error(tErrors(result.error));
      }
    });

  if (months.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.month")}</TableHead>
              <TableHead className="text-right">{t("columns.amount")}</TableHead>
              <TableHead>{t("columns.due")}</TableHead>
              <TableHead>{t("columns.state")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((month) => (
              <TableRow key={month.period} data-testid={`billing-month-${month.period}`}>
                <TableCell className="capitalize">
                  {monthLabel(month.period)}
                  <div className="text-xs text-muted-foreground">{month.packageName}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {month.amount ? tb("amount", { amount: formatDecimal(month.amount) }) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">{dateLabel(month.dueOn)}</TableCell>
                <TableCell>
                  <StatusBadge tone={TONES[month.state]}>
                    {month.state === "paid" && month.paidOn
                      ? t("paid", { date: dateLabel(month.paidOn) })
                      : t(month.state === "unpaid" ? "unpaid" : "pending")}
                  </StatusBadge>
                  {month.note ? (
                    <div className="mt-1 text-xs text-muted-foreground">{month.note}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {month.state === "paid" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setCancelling(month)}
                    >
                      {t("cancel")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        setPaidOn(today);
                        setNote("");
                        setPaying(month);
                      }}
                    >
                      {t("markPaid")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>
              {paying ? t("sheetTitle", { month: monthLabel(paying.period) }) : null}
            </SheetTitle>
          </SheetHeader>
          <form
            id="billing-payment-form"
            className="flex-1 overflow-y-auto p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (paying) save(paying, true);
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="billing-paid-on">{t("paidOn")}</FieldLabel>
                <Input
                  id="billing-paid-on"
                  type="date"
                  required
                  value={paidOn}
                  onChange={(event) => setPaidOn(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="billing-note">{t("note")}</FieldLabel>
                <Input
                  id="billing-note"
                  maxLength={200}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <FieldDescription>{t("noteHint")}</FieldDescription>
              </Field>
            </FieldGroup>
          </form>
          <SheetFooter className="border-t">
            <Button type="submit" form="billing-payment-form" disabled={pending || paidOn === ""}>
              {t("save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={cancelling ? t("cancelTitle", { month: monthLabel(cancelling.period) }) : ""}
        description={t("cancelDescription")}
        confirmLabel={t("cancelConfirm")}
        destructive
        onConfirm={() => {
          if (cancelling) save(cancelling, false);
        }}
      />
    </>
  );
}
