"use client";

import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { formatDay } from "@/lib/format";
import { saveLeaveDataAction } from "@/modules/attendance/absence-actions";
import type { LeaveBalance, LeaveData } from "@/modules/attendance/leave-rules";

type Row = { id: string; number: number; name: string; data: LeaveData; balance: LeaveBalance };

/** Leave balances of a year; HR / managers set hire date, earlier service, carry-over, override. */
export function LeaveTable({
  rows,
  year,
  canManage,
}: {
  rows: Row[];
  year: number;
  canManage: boolean;
}) {
  const t = useTranslations("absences");
  const [editing, setEditing] = useState<Row | null>(null);
  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.employee")}</TableHead>
              <TableHead>{t("columns.hiredOn")}</TableHead>
              <TableHead className="text-right">{t("columns.entitlement")}</TableHead>
              <TableHead className="text-right">{t("columns.carried")}</TableHead>
              <TableHead className="text-right">{t("columns.used")}</TableHead>
              <TableHead className="text-right">{t("columns.pending")}</TableHead>
              <TableHead className="text-right">{t("columns.available")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid="leave-row">
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground">#{row.number}</div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.data.hiredOn ? (
                    formatDay(row.data.hiredOn)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.balance.entitlement}
                  {row.data.entitlementOverride !== null ? "*" : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.balance.carriedOver}</TableCell>
                <TableCell className="text-right tabular-nums">{row.balance.used}</TableCell>
                <TableCell className="text-right tabular-nums">{row.balance.pending}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {row.balance.available}
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("editLeave", { name: row.name })}
                      onClick={() => setEditing(row)}
                    >
                      <PencilIcon />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{t("overrideNote")}</p>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {editing ? (
            <LeaveForm key={editing.id} row={editing} year={year} onDone={() => setEditing(null)} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function LeaveForm({ row, year, onDone }: { row: Row; year: number; onDone: () => void }) {
  const t = useTranslations("absences");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hiredOn, setHiredOn] = useState(row.data.hiredOn ?? "");
  const [prior, setPrior] = useState(String(row.data.priorServiceMonths));
  const [carried, setCarried] = useState(String(row.data.carriedOverDays));
  const [override, setOverride] = useState(
    row.data.entitlementOverride === null ? "" : String(row.data.entitlementOverride),
  );

  const submit = () =>
    startTransition(async () => {
      try {
        const result = await saveLeaveDataAction({
          employeeId: row.id,
          year,
          hiredOn,
          priorServiceMonths: prior,
          carriedOverDays: carried,
          entitlementOverride: override,
        });
        if (!result.ok) {
          toast.error(t(`errors.${result.error}`));
          return;
        }
        toast.success(t("leaveSavedToast", { name: row.name }));
        router.refresh();
        onDone();
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("editLeave", { name: row.name })}</SheetTitle>
        <SheetDescription>{t("editLeaveDescription", { year })}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="leave-hired">{t("fields.hiredOn")}</FieldLabel>
            <Input
              id="leave-hired"
              type="date"
              value={hiredOn}
              onChange={(event) => setHiredOn(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="leave-prior">{t("fields.priorServiceMonths")}</FieldLabel>
            <Input
              id="leave-prior"
              inputMode="numeric"
              value={prior}
              onChange={(event) => setPrior(event.target.value)}
            />
            <FieldDescription>{t("priorHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="leave-carried">{t("fields.carriedOverDays")}</FieldLabel>
            <Input
              id="leave-carried"
              inputMode="decimal"
              value={carried}
              onChange={(event) => setCarried(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="leave-override">{t("fields.entitlementOverride")}</FieldLabel>
            <Input
              id="leave-override"
              inputMode="decimal"
              value={override}
              onChange={(event) => setOverride(event.target.value)}
            />
            <FieldDescription>{t("overrideHint")}</FieldDescription>
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button disabled={pending} onClick={submit}>
          {pending ? t("sending") : t("save")}
        </Button>
      </SheetFooter>
    </>
  );
}
