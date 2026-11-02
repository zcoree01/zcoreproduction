"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { formatOneDecimal } from "@/lib/format";
import { setOrderPlanningAction } from "@/modules/planning/actions";
import type { BoardCard, BoardWorker } from "@/modules/planning/board";
import { hours } from "@/modules/planning/rules";
import type { BoardEmployee } from "./planning-board";

export type MoveTarget = {
  card: BoardCard;
  machineId: string;
  day: string;
  beforeId: string | null;
  /** "operators": dropped where an operator is needed, or "Operateri…". */
  mode: "move" | "operators";
};

/**
 * Machine, day and the responsible operator(s) of an operation. Every
 * planned operation has an operator, also on a machine that runs
 * unattended; only workers qualified for the machine are offered.
 */
export function MoveSheet({
  target,
  machines,
  employees,
  workers,
  pending,
  onClose,
  onSave,
}: {
  target: MoveTarget;
  machines: { id: string; label: string }[];
  employees: BoardEmployee[];
  workers: BoardWorker[];
  pending: boolean;
  onClose: () => void;
  onSave: (machineId: string, day: string, employeeIds: string[]) => Promise<void>;
}) {
  const t = useTranslations("planning");
  const { card } = target;
  const [machineId, setMachineId] = useState(target.machineId);
  const [day, setDay] = useState(target.day);
  const [selected, setSelected] = useState<string[]>(card.workers.map((w) => w.id));
  const qualified = employees.filter((e) => e.machineIds.includes(machineId));
  const chosen = selected.filter((id) => qualified.some((e) => e.id === id));
  const startedElsewhere =
    (card.status === "in_progress" || card.status === "paused") && machineId !== card.machineId;

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => (checked ? [...current, id] : current.filter((x) => x !== id)));

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>
            {target.mode === "operators" ? t("move.operatorsTitle") : t("move.title")}
          </SheetTitle>
          <SheetDescription>
            {t("move.description", {
              order: card.orderNumber,
              operation: `${card.code} ${card.name}`,
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <FieldGroup>
            {startedElsewhere ? (
              <Alert variant="destructive">
                <AlertDescription>{t("errors.operation_started")}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="move-machine">{t("move.machine")}</FieldLabel>
              <NativeSelect
                id="move-machine"
                className="w-full"
                value={machineId}
                onChange={(event) => setMachineId(event.target.value)}
              >
                {machines.map((machine) => (
                  <NativeSelectOption key={machine.id} value={machine.id}>
                    {machine.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="move-day">{t("move.day")}</FieldLabel>
              <Input
                id="move-day"
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">{t("move.operators")}</FieldLegend>
              <FieldDescription>{t("move.operatorsHint")}</FieldDescription>
              {qualified.length === 0 ? (
                <p className="text-sm text-destructive">{t("move.noQualified")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {qualified.map((employee) => {
                    const worker = workers.find((w) => w.id === employee.id);
                    const busy = worker?.load[day] ?? 0;
                    const absent = worker?.absent.includes(day) ?? false;
                    return (
                      <Field key={employee.id} orientation="horizontal">
                        <Checkbox
                          id={`move-worker-${employee.id}`}
                          checked={chosen.includes(employee.id)}
                          onCheckedChange={(checked) => toggle(employee.id, checked === true)}
                        />
                        <FieldLabel htmlFor={`move-worker-${employee.id}`}>
                          {employee.name}
                          {busy > 0 ? (
                            <span className="text-muted-foreground tabular-nums">
                              {t("move.busy", {
                                hours: formatOneDecimal(hours(busy)),
                              })}
                            </span>
                          ) : null}
                          {absent ? (
                            <span className="text-destructive">{t("move.absent")}</span>
                          ) : null}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </div>
              )}
              {chosen.length === 0 && qualified.length > 0 ? (
                <FieldDescription>{t("move.chooseOperator")}</FieldDescription>
              ) : null}
            </FieldSet>
          </FieldGroup>
        </div>
        <SheetFooter className="border-t">
          <Button
            disabled={pending || chosen.length === 0 || day === "" || startedElsewhere}
            onClick={() => void onSave(machineId, day, chosen)}
          >
            {t("move.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Priority (or automatic) and due date of the card's order. */
export function OrderPlanningSheet({
  card,
  onClose,
}: {
  card: BoardCard | null;
  onClose: () => void;
}) {
  const t = useTranslations("planning");
  return (
    <Sheet open={card !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        {card ? (
          <OrderPlanningForm key={card.id} card={card} onDone={onClose} />
        ) : (
          <SheetHeader>
            <SheetTitle>{t("orderPlanning.title")}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function OrderPlanningForm({ card, onDone }: { card: BoardCard; onDone: () => void }) {
  const t = useTranslations("planning");
  const tPriority = useTranslations("priority");
  const [priority, setPriority] = useState(card.manualPriority?.toString() ?? "");
  const [dueDate, setDueDate] = useState(card.dueDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await setOrderPlanningAction({
        orderId: card.orderId,
        priority: priority === "" ? null : Number(priority),
        dueDate,
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("saved"));
      onDone();
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("orderPlanning.title")}</SheetTitle>
        <SheetDescription>
          {card.orderNumber} · {card.partNumber} {card.productName}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="order-planning-priority">{t("orderPlanning.priority")}</FieldLabel>
            <NativeSelect
              id="order-planning-priority"
              className="w-full"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <NativeSelectOption value="">{t("orderPlanning.automatic")}</NativeSelectOption>
              {[1, 2, 3, 4, 5].map((level) => (
                <NativeSelectOption key={level} value={String(level)}>
                  {level} · {tPriority(`levels.${level}` as "levels.1")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="order-planning-due">{t("orderPlanning.dueDate")}</FieldLabel>
            <Input
              id="order-planning-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button onClick={save} disabled={pending || dueDate === ""}>
          {t("orderPlanning.save")}
        </Button>
      </SheetFooter>
    </>
  );
}
