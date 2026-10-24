"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { MachineStatusBadge } from "@/components/shared/machine-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { setMachineStatusAction } from "@/modules/machines/actions";
import type { MachineStatus } from "@/modules/machines/schemas";
import { allowedStatusTargets, OPERATOR_STATUSES } from "@/modules/machines/status-rules";

export type FloorMachine = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  status: MachineStatus;
};

// One machine with large status buttons (touch targets ≥ 48px).
export function FloorMachineCard({ machine, since }: { machine: FloorMachine; since: string }) {
  const t = useTranslations("floorMachines");
  const tStatus = useTranslations("machineStatus");
  const [pending, startTransition] = useTransition();
  const allowed = allowedStatusTargets("operator", machine.status);

  const setStatus = (status: MachineStatus) =>
    startTransition(async () => {
      const result = await setMachineStatusAction(machine.id, status);
      if (result.ok) {
        toast.success(t("changedToast", { code: machine.code, status: tStatus(status) }));
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <Card>
      <CardHeader>
        {/* Long names wrap; the status sits on its own row so it is never clipped. */}
        <CardTitle className="text-lg break-words">
          <span className="font-mono">{machine.code}</span> · {machine.name}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <MachineStatusBadge status={machine.status} />
          <span>{[machine.location, since].filter(Boolean).join(" · ")}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allowed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("inactiveMachine")}</p>
        ) : (
          <div
            role="group"
            aria-label={t("statusGroup", { code: machine.code })}
            className="grid grid-cols-2 gap-2"
          >
            {OPERATOR_STATUSES.map((status) => {
              const current = status === machine.status;
              return (
                <Button
                  key={status}
                  variant={current ? "default" : "outline"}
                  aria-pressed={current}
                  disabled={pending || current}
                  onClick={() => setStatus(status)}
                  className={cn("h-12 text-base", current && "disabled:opacity-100")}
                >
                  {tStatus(status)}
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
