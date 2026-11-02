"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  GripVerticalIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  WrenchIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition, type DragEvent } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PriorityBadge } from "@/components/shared/order-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatOneDecimal, formatShortDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isoWeekday } from "@/modules/attendance/schedule-rules";
import {
  archiveDowntimeAction,
  planMovesAction,
  rebalanceAction,
} from "@/modules/planning/actions";
import type { BoardCard, BoardMachine, BoardModel } from "@/modules/planning/board";
import type { PlanningDowntime } from "@/modules/planning/queries";
import {
  hours,
  insertIntoDay,
  shiftWithinDay,
  type OperationWarning,
} from "@/modules/planning/rules";
import type { PlanMoveInput, PlanningResult } from "@/modules/planning/schemas";
import { DowntimeSheet } from "./downtime-sheet";
import { MoveSheet, OrderPlanningSheet, type MoveTarget } from "./plan-sheets";

export type BoardEmployee = { id: string; name: string; machineIds: string[] };

const cellKey = (machineId: string, day: string) => `${machineId}|${day}`;

/**
 * Machines × days (D-041). Cards are dragged to another day or machine (or
 * back to "Nije u planu"), arrows reorder within a day; a move to another
 * machine or of an operation without an operator asks for the operator.
 */
export function PlanningBoard({
  board,
  employees,
  canManage,
  canManageDowntime,
}: {
  board: BoardModel;
  employees: BoardEmployee[];
  canManage: boolean;
  canManageDowntime: boolean;
}) {
  const t = useTranslations("planning");
  const [pending, startTransition] = useTransition();
  const [dragged, setDragged] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [orderCard, setOrderCard] = useState<BoardCard | null>(null);
  const [downtime, setDowntime] = useState<
    (Partial<PlanningDowntime> & { machineId: string; startsOn: string }) | null
  >(null);
  const [removeDowntime, setRemoveDowntime] = useState<string | null>(null);

  const allCards = [...board.cards, ...board.unplanned];
  const cardById = new Map(allCards.map((card) => [card.id, card]));
  const cellCards = (machineId: string, day: string) =>
    board.cards
      .filter((card) => card.machineId === machineId && card.planDay === day)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const short = formatShortDay;
  const num = formatOneDecimal;

  const report = (result: PlanningResult, success?: string) => {
    if (!result.ok) {
      toast.error(t(`errors.${result.error}`));
      return false;
    }
    if (success) toast.success(success);
    return true;
  };

  const send = (moves: PlanMoveInput[], success?: string) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        resolve(report(await planMovesAction(moves), success));
      });
    });

  /** Moves of a whole day after placing `card` before `beforeId`. */
  const placeMoves = (
    card: BoardCard,
    machineId: string,
    day: string,
    beforeId: string | null,
    employeeIds?: string[],
  ): PlanMoveInput[] => {
    const ids = insertIntoDay(
      cellCards(machineId, day).map((c) => c.id),
      card.id,
      beforeId,
    );
    return ids.flatMap((id, index): PlanMoveInput[] => {
      const other = cardById.get(id);
      if (id !== card.id && other?.position === index + 1) return [];
      return [
        {
          operationId: id,
          machineId,
          planDay: day,
          position: index + 1,
          ...(id === card.id && employeeIds ? { employeeIds } : {}),
        },
      ];
    });
  };

  const needsOperator = (card: BoardCard, machineId: string) =>
    card.workers.length === 0 ||
    card.workers.some((w) => !employees.find((e) => e.id === w.id)?.machineIds.includes(machineId));

  const drop = (machineId: string, day: string, beforeId: string | null) => {
    const card = dragged ? cardById.get(dragged) : undefined;
    setDragged(null);
    setHover(null);
    if (!card || card.id === beforeId) return;
    if (needsOperator(card, machineId)) {
      setMoveTarget({ card, machineId, day, beforeId, mode: "operators" });
      return;
    }
    void send(placeMoves(card, machineId, day, beforeId), t("saved"));
  };

  const shift = (card: BoardCard, delta: -1 | 1) => {
    if (!card.machineId || !card.planDay) return;
    const ids = cellCards(card.machineId, card.planDay).map((c) => c.id);
    const next = shiftWithinDay(ids, card.id, delta);
    const moves = next.flatMap((id, index): PlanMoveInput[] =>
      cardById.get(id)?.position === index + 1
        ? []
        : [
            {
              operationId: id,
              machineId: card.machineId,
              planDay: card.planDay,
              position: index + 1,
            },
          ],
    );
    if (moves.length > 0) void send(moves, t("saved"));
  };

  const unplan = (card: BoardCard) =>
    void send([{ operationId: card.id, machineId: card.machineId, planDay: null, position: null }]);

  const dragProps = (card: BoardCard) =>
    canManage
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", card.id);
            setDragged(card.id);
          },
          onDragEnd: () => {
            setDragged(null);
            setHover(null);
          },
        }
      : {};

  const dropProps = (key: string, onDrop: () => void) =>
    canManage
      ? {
          onDragOver: (event: DragEvent) => {
            if (!dragged) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (hover !== key) setHover(key);
          },
          onDragLeave: () => setHover((current) => (current === key ? null : current)),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            onDrop();
          },
        }
      : {};

  const warningText = (warning: OperationWarning) => {
    switch (warning.kind) {
      case "late":
        return warning.endDay
          ? t("warnings.late", { end: short(warning.endDay), due: short(warning.dueDate) })
          : t("warnings.lateUnknown", { due: short(warning.dueDate) });
      case "cannot_start":
        return warning.startDay
          ? t("warnings.cannot_start", { day: short(warning.startDay) })
          : t("warnings.cannotStartNever");
      case "before_previous":
        return warning.previousEnd
          ? t("warnings.before_previous", { day: short(warning.previousEnd) })
          : t("warnings.beforePreviousUnknown");
      default:
        return t(`warnings.${warning.kind}`);
    }
  };

  const proposals = board.machines.filter((machine) => machine.proposal.length > 0);
  const proposalCount = proposals.reduce((sum, machine) => sum + machine.proposal.length, 0);
  const proposalList = proposals
    .map((machine) =>
      t("overload.machineLine", {
        machine: machine.code,
        list: machine.proposal
          .map((move) => t("overload.move", { label: move.label, to: short(move.to) }))
          .join(", "),
      }),
    )
    .join("; ");

  const rebalance = () =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await rebalanceAction({
          machineIds: proposals.map((machine) => machine.id),
          basis: board.basis,
        });
        if (result.ok) {
          report(
            result,
            result.moved ? t("overload.done", { count: result.moved }) : t("overload.nothing"),
          );
        } else report(result);
        resolve();
      });
    });

  const renderCard = (card: BoardCard, index?: number, count?: number) => {
    const started = card.status === "in_progress" || card.status === "paused";
    const warnings = card.warnings;
    return (
      <div
        key={card.id}
        {...dragProps(card)}
        {...(card.planDay && card.machineId
          ? dropProps(`${cellKey(card.machineId, card.planDay)}|${card.id}`, () =>
              drop(card.machineId ?? "", card.planDay ?? "", card.id),
            )
          : {})}
        data-testid="plan-card"
        data-operation-id={card.id}
        className={cn(
          "group/card flex flex-col gap-1 rounded-md border bg-card p-2 text-xs shadow-xs",
          canManage && "cursor-grab active:cursor-grabbing",
          dragged === card.id && "opacity-50",
          warnings.some((w) => w.kind === "late" || w.kind === "cannot_start") &&
            "border-destructive/60",
          started && "border-l-4 border-l-emerald-500",
        )}
      >
        <div className="flex items-start gap-1">
          {canManage ? (
            <GripVerticalIcon
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-label={t("card.drag")}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <Link
                href={`/orders/${card.orderId}`}
                className="font-semibold tabular-nums hover:underline"
              >
                {card.orderNumber}
              </Link>
              <span className="text-muted-foreground">· {card.code}</span>
            </div>
            <p className="truncate" title={`${card.partNumber} ${card.productName}`}>
              {card.partNumber} {card.productName}
            </p>
          </div>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label={t("card.menu")} />}
              >
                <EllipsisVerticalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href={`/orders/${card.orderId}`} />}>
                  {t("card.openOrder")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    setMoveTarget({
                      card,
                      machineId: card.machineId ?? board.machines[0]?.id ?? "",
                      day: card.planDay ?? board.today,
                      beforeId: null,
                      mode: "move",
                    })
                  }
                >
                  {t("card.move")}
                </DropdownMenuItem>
                {card.planDay && card.machineId ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setMoveTarget({
                        card,
                        machineId: card.machineId ?? "",
                        day: card.planDay ?? board.today,
                        beforeId: null,
                        mode: "operators",
                      })
                    }
                  >
                    {t("card.operators")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setOrderCard(card)}>
                  {t("card.orderPlanning")}
                </DropdownMenuItem>
                {card.planDay ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => unplan(card)}>
                      {t("card.unplan")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <PriorityBadge
            priority={card.priority}
            automatic={card.manualPriority === null}
            className="h-4 px-1.5 text-[11px]"
          />
          <span className="text-muted-foreground">
            {t("card.due", { date: short(card.dueDate) })}
          </span>
          {started ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[11px]">
              {t("card.inProgress")}
            </Badge>
          ) : null}
        </div>
        <p className="tabular-nums">
          <span>{t("card.planned", { hours: num(hours(card.plannedSeconds)) })}</span>
          {card.actualSeconds !== null ? (
            <span
              className="text-muted-foreground"
              title={card.actualSource === "own" ? t("card.actualOwn") : t("card.actualHistory")}
            >
              {" · "}
              {t("card.actual", { hours: num(hours(card.actualSeconds)) })}
              {card.deviationPercent !== null ? (
                <span
                  className={cn(
                    card.deviationPercent > 10 && "text-destructive",
                    card.deviationPercent < -10 && "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {" "}
                  (
                  {t("card.deviation", {
                    value: `${card.deviationPercent > 0 ? "+" : ""}${num(card.deviationPercent)}`,
                  })}
                  )
                </span>
              ) : null}
            </span>
          ) : null}
        </p>
        <p
          className={cn("flex items-center gap-1", card.workers.length === 0 && "text-destructive")}
        >
          <UserRoundIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {card.workers.length > 0
              ? card.workers.map((w) => w.name).join(", ")
              : t("card.noOperator")}
          </span>
        </p>
        {card.waitingExternal ? (
          <p className="text-amber-700 dark:text-amber-400">
            {t("card.waitingExternal", {
              name: `${card.waitingExternal.code} ${card.waitingExternal.company ?? card.waitingExternal.name}`,
            })}
          </p>
        ) : null}
        {card.planDay && card.forecast?.endDay && card.forecast.endDay !== card.planDay ? (
          <p className="text-muted-foreground">
            {t("card.ends", { date: short(card.forecast.endDay) })}
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-0.5" data-testid="plan-card-warnings">
            {warnings.map((warning) => (
              <li
                key={warning.kind}
                className={cn(
                  "flex items-start gap-1",
                  warning.kind === "late" || warning.kind === "cannot_start"
                    ? "text-destructive"
                    : "text-amber-700 dark:text-amber-400",
                )}
              >
                <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{warningText(warning)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canManage && index !== undefined && count !== undefined && count > 1 ? (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("card.moveUp")}
              disabled={pending || index === 0}
              onClick={() => shift(card, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("card.moveDown")}
              disabled={pending || index === count - 1}
              onClick={() => shift(card, 1)}
            >
              <ArrowDownIcon />
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderMachineHeader = (machine: BoardMachine) => {
    return (
      <div className="flex h-full flex-col gap-1 p-2 text-xs">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{machine.code}</p>
            <p className="truncate text-muted-foreground">{machine.name}</p>
          </div>
          {canManageDowntime ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label={t("downtime.title")} />}
              >
                <WrenchIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuItem
                  onClick={() => setDowntime({ machineId: machine.id, startsOn: board.today })}
                >
                  {t("downtime.title")}…
                </DropdownMenuItem>
                {machine.downtimes.map((d) => (
                  <div key={d.id} className="border-t px-2 py-1.5">
                    <p className="font-medium">
                      {d.endsOn
                        ? t("downtime.period", { from: short(d.startsOn), to: short(d.endsOn) })
                        : t("downtime.periodOpen", { from: short(d.startsOn) })}
                    </p>
                    {d.reasonName || d.note ? (
                      <p className="text-muted-foreground">
                        {[d.reasonName, d.note].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.endsOn === null ? (
                        <DropdownMenuItem
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setDowntime({
                              ...d,
                              endsOn: board.today < d.startsOn ? d.startsOn : board.today,
                            })
                          }
                        >
                          {t("downtime.endToday")}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="h-7 px-2 text-xs" onClick={() => setDowntime(d)}>
                        {t("downtime.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="h-7 px-2 text-xs"
                        onClick={() => setRemoveDowntime(d.id)}
                      >
                        {t("downtime.remove")}
                      </DropdownMenuItem>
                    </div>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="text-muted-foreground">
          {t("capacity", { hours: num(machine.capacityHours) })}
        </p>
        {machine.runsUnattended ? (
          <Badge variant="outline" className="w-fit" title={t("unattendedHint")}>
            {t("unattended")}
          </Badge>
        ) : null}
      </div>
    );
  };

  const columns = `12rem repeat(${board.days.length}, minmax(11rem, 1fr))`;

  return (
    <div className="flex flex-col gap-4">
      {proposals.length > 0 ||
      board.machines.some((m) => Object.values(m.days).some((d) => d.overloaded)) ? (
        <Alert variant="destructive" data-testid="plan-overload">
          <TriangleAlertIcon />
          <AlertTitle>{t("overload.title")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t("overload.description")}</span>
            {proposals.length > 0 ? <span className="text-foreground">{proposalList}</span> : null}
            {canManage && proposals.length > 0 ? (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-fit" disabled={pending}>
                    {t("overload.apply")}
                  </Button>
                }
                title={t("overload.confirmTitle")}
                description={t("overload.confirmDescription", {
                  count: proposalCount,
                  list: proposalList,
                })}
                confirmLabel={t("overload.confirm")}
                onConfirm={rebalance}
              />
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <section
          aria-labelledby="plan-unplanned"
          {...dropProps("unplanned", () => {
            const card = dragged ? cardById.get(dragged) : undefined;
            setDragged(null);
            setHover(null);
            if (card?.planDay) unplan(card);
          })}
          className={cn(
            "flex max-h-[75vh] flex-col gap-2 rounded-lg border p-3",
            hover === "unplanned" && "ring-2 ring-primary",
          )}
          data-testid="plan-unplanned"
        >
          <div>
            <h2 id="plan-unplanned" className="font-semibold">
              {t("unplanned.title")}{" "}
              <span className="font-normal text-muted-foreground">
                ({t("unplanned.count", { count: board.unplanned.length })})
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">{t("unplanned.hint")}</p>
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto">
            {board.unplanned.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("unplanned.empty")}</p>
            ) : (
              board.unplanned.map((card) => renderCard(card))
            )}
          </div>
        </section>

        {board.machines.length === 0 ? (
          <p className="rounded-lg border p-6 text-sm text-muted-foreground">
            {t("emptyMachines")}
          </p>
        ) : (
          <div className="self-start overflow-x-auto rounded-lg border" data-testid="plan-board">
            <div className="grid min-w-max" style={{ gridTemplateColumns: columns }}>
              <div className="sticky left-0 z-10 border-r border-b bg-background p-2 text-xs font-medium text-muted-foreground">
                {t("machine")}
              </div>
              {board.days.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    "border-b p-2 text-xs",
                    !day.working && "bg-muted/60",
                    day.today && "bg-primary/10",
                  )}
                >
                  <p className="font-medium capitalize">
                    {t(`weekdays.${isoWeekday(day.date)}`)} {short(day.date)}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {day.holiday ?? (day.working ? " " : t("nonWorking"))}
                  </p>
                </div>
              ))}

              {board.machines.map((machine) => (
                <div
                  key={machine.id}
                  className="contents"
                  data-testid={`plan-machine-${machine.code}`}
                >
                  <div className="sticky left-0 z-10 border-r border-b bg-background">
                    {renderMachineHeader(machine)}
                  </div>
                  {board.days.map((day) => {
                    const load = machine.days[day.date];
                    const cards = cellCards(machine.id, day.date);
                    const key = cellKey(machine.id, day.date);
                    if (!load) return <div key={day.date} className="border-b" />;
                    const percent =
                      load.capacity > 0 ? Math.min(100, (load.used / load.capacity) * 100) : 0;
                    return (
                      <div
                        key={day.date}
                        {...dropProps(key, () => drop(machine.id, day.date, null))}
                        data-testid="plan-cell"
                        data-machine={machine.code}
                        data-day={day.date}
                        data-overloaded={load.overloaded || undefined}
                        className={cn(
                          "flex min-h-28 flex-col gap-1.5 border-b border-l p-1.5",
                          !day.working && "bg-muted/40",
                          load.down &&
                            "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--color-muted)_6px,var(--color-muted)_12px)]",
                          load.overloaded &&
                            "bg-destructive/5 ring-1 ring-destructive/50 ring-inset",
                          hover === key && "ring-2 ring-primary ring-inset",
                        )}
                      >
                        <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                          <span
                            className="tabular-nums"
                            title={load.overloaded ? t("overloadedHint") : undefined}
                          >
                            {load.down
                              ? t("down")
                              : t("load", {
                                  used: num(hours(load.carriedIn + load.planned)),
                                  capacity: num(hours(load.capacity)),
                                })}
                          </span>
                          {load.overloaded ? (
                            <span className="font-medium text-destructive">{t("overloaded")}</span>
                          ) : null}
                        </div>
                        {load.capacity > 0 ? (
                          <div className="h-1 rounded-full bg-muted" aria-hidden>
                            <div
                              className={cn(
                                "h-1 rounded-full",
                                load.overloaded ? "bg-destructive" : "bg-primary",
                              )}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        ) : null}
                        {load.continuing.map((item) => (
                          <p
                            key={item.id}
                            className="truncate rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            title={t("continuing", { label: item.label })}
                          >
                            ↳ {item.label} · {t("carried")}
                          </p>
                        ))}
                        {cards.map((card, index) => renderCard(card, index, cards.length))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <WorkerLoad board={board} short={short} num={num} />

      {moveTarget ? (
        <MoveSheet
          key={`${moveTarget.card.id}-${moveTarget.mode}`}
          target={moveTarget}
          machines={board.machines.map((m) => ({ id: m.id, label: `${m.code} · ${m.name}` }))}
          employees={employees}
          workers={board.workers}
          onClose={() => setMoveTarget(null)}
          onSave={async (machineId, day, employeeIds) => {
            const card = moveTarget.card;
            const sameCell = card.machineId === machineId && card.planDay === day;
            const moves =
              moveTarget.mode === "operators" && sameCell
                ? [
                    {
                      operationId: card.id,
                      machineId,
                      planDay: day,
                      position: card.position ?? 1,
                      employeeIds,
                    },
                  ]
                : placeMoves(card, machineId, day, moveTarget.beforeId, employeeIds);
            const ok = await send(moves, t("saved"));
            if (ok) setMoveTarget(null);
          }}
          pending={pending}
        />
      ) : null}
      <OrderPlanningSheet card={orderCard} onClose={() => setOrderCard(null)} />
      {downtime ? (
        <DowntimeSheet
          open
          onOpenChange={(open) => (open ? undefined : setDowntime(null))}
          machines={board.machines.map((m) => ({ id: m.id, label: `${m.code} · ${m.name}` }))}
          reasons={board.reasons}
          initial={downtime}
        />
      ) : null}
      <ConfirmDialog
        open={removeDowntime !== null}
        onOpenChange={(open) => (open ? undefined : setRemoveDowntime(null))}
        title={t("downtime.removeTitle")}
        description={t("downtime.removeDescription")}
        confirmLabel={t("downtime.remove")}
        destructive
        onConfirm={async () => {
          if (!removeDowntime) return;
          const result = await archiveDowntimeAction(removeDowntime);
          if (report(result, t("downtime.removed"))) setRemoveDowntime(null);
        }}
      />
    </div>
  );
}

function WorkerLoad({
  board,
  short,
  num,
}: {
  board: BoardModel;
  short: (day: string) => string;
  num: (value: number) => string;
}) {
  const t = useTranslations("planning.workers");
  const limit = board.workHoursPerDay * 3600;
  const rows = board.workers.filter((worker) => Object.values(worker.load).some((s) => s > 0));
  return (
    <section
      aria-labelledby="plan-workers"
      className="flex flex-col gap-2"
      data-testid="plan-workers"
    >
      <div>
        <h2 id="plan-workers" className="font-semibold">
          {t("title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("description", { hours: num(board.workHoursPerDay) })}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-max text-xs">
            <thead>
              <tr className="border-b">
                <th scope="col" className="sticky left-0 bg-background p-2 text-left font-medium">
                  {t("title")}
                </th>
                {board.days.map((day) => (
                  <th
                    key={day.date}
                    scope="col"
                    className={cn(
                      "p-2 text-right font-medium tabular-nums",
                      !day.working && "bg-muted/60",
                    )}
                  >
                    {short(day.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((worker) => (
                <tr key={worker.id} className="border-b last:border-0">
                  <th scope="row" className="sticky left-0 bg-background p-2 text-left font-normal">
                    {worker.name}
                  </th>
                  {board.days.map((day) => {
                    const seconds = worker.load[day.date] ?? 0;
                    const absent = worker.absent.includes(day.date);
                    return (
                      <td
                        key={day.date}
                        className={cn(
                          "p-2 text-right tabular-nums",
                          !day.working && "bg-muted/60",
                          (seconds > limit || (absent && seconds > 0)) &&
                            "font-semibold text-destructive",
                        )}
                      >
                        {absent ? `${t("absent")} ` : ""}
                        {seconds > 0
                          ? t("hours", { hours: num(hours(seconds)) })
                          : absent
                            ? ""
                            : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
