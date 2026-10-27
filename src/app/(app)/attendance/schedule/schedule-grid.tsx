"use client";

import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  applyRotationsAction,
  copyScheduleWeekAction,
  setScheduleEntriesAction,
} from "@/modules/attendance/schedule-actions";
import type { ScheduleRow } from "@/modules/attendance/schedule-queries";
import {
  addDays,
  isoWeekday,
  isWeekend,
  mondayOf,
  type ScheduleView,
} from "@/modules/attendance/schedule-rules";

type GridShift = {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
  color: string | null;
};

type Props = {
  view: ScheduleView;
  date: string;
  today: string;
  dates: string[];
  rows: ScheduleRow[];
  shifts: GridShift[];
  crews: { id: string; name: string }[];
  crew: string | null;
  canManage: boolean;
  links: {
    previous: string;
    next: string;
    today: string;
    week: string;
    month: string;
    crewBase: string;
  };
};

/**
 * The schedule grid: employees × days. With attendance.manage a cell opens a
 * menu of shifts (or day off); rotations are written for the visible range;
 * a week can be copied to the next one.
 */
export function ScheduleGrid(props: Props) {
  const { dates, rows, shifts, canManage, view, links } = props;
  const t = useTranslations("schedule");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"apply" | "copy" | null>(null);
  const byId = new Map(shifts.map((shift) => [shift.id, shift]));
  const from = dates[0] ?? props.date;
  const to = dates.at(-1) ?? props.date;

  const run = (
    action: () => Promise<{ ok: boolean; error?: string; count?: number }>,
    success: (count: number) => string,
  ) =>
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof action>>;
      try {
        result = await action();
      } catch {
        toast.error(t("errors.offline"));
        return;
      }
      if (result.ok) {
        toast.success(success(result.count ?? 0));
        router.refresh();
      } else {
        toast.error(
          t(
            `errors.${result.error === "denied" || result.error === "not_found" || result.error === "invalid" ? result.error : "unexpected"}`,
          ),
        );
      }
    });

  const setCell = (employeeId: string, workDate: string, shiftId: string | null) =>
    run(
      () => setScheduleEntriesAction([{ employeeId, workDate, shiftId }]),
      () => t("savedToast"),
    );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={links.previous}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label={t("previous")}
          >
            <ChevronLeftIcon />
          </Link>
          <Link href={links.today} className={buttonVariants({ variant: "outline" })}>
            {t("today")}
          </Link>
          <Link
            href={links.next}
            className={buttonVariants({ variant: "outline", size: "icon" })}
            aria-label={t("next")}
          >
            <ChevronRightIcon />
          </Link>
        </div>
        <span className="font-medium tabular-nums" data-testid="schedule-range">
          {formatDay(from)} – {formatDay(to)}
        </span>
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          <Link
            href={links.week}
            aria-current={view === "week" ? "page" : undefined}
            className={buttonVariants({
              variant: view === "week" ? "secondary" : "ghost",
              size: "sm",
            })}
          >
            {t("week")}
          </Link>
          <Link
            href={links.month}
            aria-current={view === "month" ? "page" : undefined}
            className={buttonVariants({
              variant: view === "month" ? "secondary" : "ghost",
              size: "sm",
            })}
          >
            {t("month")}
          </Link>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("crew")}
          <NativeSelect
            value={props.crew ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              const url = new URL(links.crewBase, window.location.origin);
              if (value) url.searchParams.set("crew", value);
              router.push(`${url.pathname}?${url.searchParams.toString()}`);
            }}
          >
            <NativeSelectOption value="">{t("allCrews")}</NativeSelectOption>
            {props.crews.map((crew) => (
              <NativeSelectOption key={crew.id} value={crew.id}>
                {crew.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {canManage ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirm("apply")}>
              <RefreshCwIcon />
              {t("applyRotations")}
            </Button>
            {view === "week" ? (
              <Button variant="outline" disabled={pending} onClick={() => setConfirm("copy")}>
                <CopyIcon />
                {t("copyWeek")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {shifts.map((shift) => (
          <span key={shift.id} className="flex items-center gap-1">
            <ShiftBadge shift={shift} />
            {shift.name} {shift.startsAt}–{shift.endsAt}
          </span>
        ))}
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-foreground" aria-hidden />
          {t("manualLegend")}
        </span>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm" data-testid="schedule-grid">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 min-w-48 bg-muted/50 px-3 py-2 text-left font-medium">
                  {t("employee")}
                </th>
                {dates.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className={cn(
                      "px-1 py-2 text-center font-normal",
                      isWeekend(day) && "bg-muted",
                      day === props.today && "text-primary",
                    )}
                  >
                    <div className="text-xs text-muted-foreground">
                      {t(`weekdays.${isoWeekday(day)}`)}
                    </div>
                    <div className={cn("tabular-nums", day === props.today && "font-semibold")}>
                      {Number(day.slice(8))}.
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0" data-testid="schedule-row">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background px-3 py-1.5 text-left font-normal"
                  >
                    <div className="font-medium">{row.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      #{row.number}
                      {row.crew ? (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[10px]"
                          style={
                            row.crewColor
                              ? { borderColor: row.crewColor, color: row.crewColor }
                              : undefined
                          }
                        >
                          {row.crew}
                        </Badge>
                      ) : null}
                    </div>
                  </th>
                  {dates.map((day) => {
                    const entry = row.entries[day];
                    const shift = entry ? byId.get(entry.shiftId) : undefined;
                    const label = t("cellLabel", {
                      name: row.name,
                      day: formatDay(day),
                      shift: shift ? shift.name : t("dayOff"),
                    });
                    const content = shift ? (
                      <span className="relative inline-flex">
                        <ShiftBadge shift={shift} />
                        {entry?.source === "manual" ? (
                          <span
                            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-foreground"
                            aria-hidden
                          />
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">·</span>
                    );
                    return (
                      <td
                        key={day}
                        className={cn("px-0.5 py-1 text-center", isWeekend(day) && "bg-muted/60")}
                      >
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label={label}
                                  disabled={pending}
                                  className="flex h-8 w-full min-w-9 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                />
                              }
                            >
                              {content}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center" className="w-56">
                              <DropdownMenuGroup>
                                <DropdownMenuLabel>
                                  {row.name} · {formatDay(day)}
                                </DropdownMenuLabel>
                                {shifts.map((option) => (
                                  <DropdownMenuItem
                                    key={option.id}
                                    onClick={() => setCell(row.id, day, option.id)}
                                  >
                                    <ShiftBadge shift={option} />
                                    {option.name}
                                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                                      {option.startsAt}–{option.endsAt}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem onClick={() => setCell(row.id, day, null)}>
                                  {t("dayOff")}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span aria-label={label} className="flex h-8 items-center justify-center">
                            {content}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "apply"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("applyTitle")}
        description={t("applyDescription", { from: formatDay(from), to: formatDay(to) })}
        confirmLabel={t("applyConfirm")}
        onConfirm={async () => {
          run(
            () => applyRotationsAction({ from, to }),
            (count) => t("appliedToast", { count }),
          );
        }}
      />
      <ConfirmDialog
        open={confirm === "copy"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("copyTitle")}
        description={t("copyDescription", {
          from: formatDay(mondayOf(from)),
          to: formatDay(addDays(mondayOf(from), 7)),
        })}
        confirmLabel={t("copyConfirm")}
        onConfirm={async () => {
          run(
            () =>
              copyScheduleWeekAction({
                sourceMonday: mondayOf(from),
                targetMonday: addDays(mondayOf(from), 7),
              }),
            (count) => t("copiedToast", { count }),
          );
        }}
      />
    </section>
  );
}

function ShiftBadge({ shift }: { shift: GridShift }) {
  return (
    <Badge
      variant="outline"
      className="min-w-8 justify-center px-1 font-mono text-xs"
      style={
        shift.color
          ? { borderColor: shift.color, backgroundColor: `${shift.color}22`, color: shift.color }
          : undefined
      }
    >
      {shift.code}
    </Badge>
  );
}
