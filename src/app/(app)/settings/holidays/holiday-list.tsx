"use client";

import { ArchiveIcon, CalendarPlusIcon, DownloadIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  importHolidaysAction,
  saveHolidayAction,
  setHolidayScopeAction,
} from "@/modules/attendance/payroll-actions";
import type { OrgHoliday } from "@/modules/attendance/payroll-queries";
import { HOLIDAY_SCOPES, type PayrollActionResult } from "@/modules/attendance/payroll-schemas";

export function HolidayList({
  year,
  holidays,
  scopes,
}: {
  year: number;
  holidays: OrgHoliday[];
  scopes: Record<string, "all" | "selected">;
}) {
  const t = useTranslations("holidays");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState(`${year}-01-01`);

  const run = (action: () => Promise<PayrollActionResult>, success: string) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          toast.success(success);
          router.refresh();
        } else toast.error(t(`errors.${result.error}`));
      } catch {
        toast.error(t("errors.unexpected"));
      }
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => importHolidaysAction(year), t("importedToast"))}
        >
          <DownloadIcon />
          {t("import", { year })}
        </Button>
        <Input
          aria-label={t("newName")}
          placeholder={t("newName")}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          className="w-56"
        />
        <Input
          aria-label={t("newDate")}
          type="date"
          value={newDate}
          onChange={(event) => setNewDate(event.target.value)}
          className="w-40"
        />
        <Button
          variant="outline"
          disabled={pending || newName.trim() === ""}
          onClick={() => {
            run(() => saveHolidayAction(null, { name: newName, date: newDate }), t("savedToast"));
            setNewName("");
          }}
        >
          <CalendarPlusIcon />
          {t("add")}
        </Button>
      </div>
      {holidays.length === 0 ? (
        <EmptyState
          icon={<CalendarPlusIcon />}
          title={t("emptyTitle", { year })}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.scope")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((holiday) => (
                <HolidayRow
                  key={holiday.id}
                  holiday={holiday}
                  scope={scopes[holiday.key] ?? "none"}
                  pending={pending}
                  run={run}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </section>
  );
}

function HolidayRow({
  holiday,
  scope,
  pending,
  run,
}: {
  holiday: OrgHoliday;
  scope: "none" | "all" | "selected";
  pending: boolean;
  run: (action: () => Promise<PayrollActionResult>, success: string) => void;
}) {
  const t = useTranslations("holidays");
  const [date, setDate] = useState(holiday.date);
  const [name, setName] = useState(holiday.name);
  const changed = date !== holiday.date || name !== holiday.name;
  return (
    <TableRow data-testid="holiday-row" className={holiday.archived ? "opacity-60" : undefined}>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={t("columns.date")}
            value={date}
            disabled={holiday.archived}
            onChange={(event) => setDate(event.target.value)}
            className="w-40"
          />
          {!holiday.confirmed ? (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
              {t("verifyDate")}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Input
          aria-label={t("columns.name")}
          value={name}
          disabled={holiday.archived}
          onChange={(event) => setName(event.target.value)}
        />
      </TableCell>
      <TableCell className="text-sm">{t(`kinds.${holiday.kind}`)}</TableCell>
      <TableCell>
        <NativeSelect
          aria-label={t("columns.scope")}
          value={scope}
          disabled={pending}
          onChange={(event) => {
            const next = HOLIDAY_SCOPES.find((item) => item === event.target.value);
            if (next)
              run(
                () => setHolidayScopeAction({ key: holiday.key, scope: next }),
                t("scopeSavedToast"),
              );
          }}
        >
          {HOLIDAY_SCOPES.map((item) => (
            <NativeSelectOption key={item} value={item}>
              {t(`scopes.${item}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {changed && !holiday.archived ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("save")}
              disabled={pending}
              onClick={() =>
                run(() => saveHolidayAction(holiday.id, { name, date }), t("savedToast"))
              }
            >
              <SaveIcon />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={holiday.archived ? t("restore") : t("archive")}
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveHolidayAction(
                    holiday.id,
                    { name: holiday.name, date: holiday.date },
                    !holiday.archived,
                  ),
                t("savedToast"),
              )
            }
          >
            {holiday.archived ? <RotateCcwIcon /> : <ArchiveIcon />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
