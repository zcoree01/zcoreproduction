import { useTranslations } from "next-intl";
import type { MachineStatus } from "@/modules/machines/schemas";
import { StatusBadge, type StatusTone } from "./status-badge";

export const MACHINE_STATUS_TONE: Record<MachineStatus, StatusTone> = {
  available: "info",
  running: "success",
  stopped: "danger",
  maintenance: "warning",
  inactive: "neutral",
};

export function MachineStatusBadge({
  status,
  className,
}: {
  status: MachineStatus;
  className?: string;
}) {
  const t = useTranslations("machineStatus");
  return (
    <StatusBadge tone={MACHINE_STATUS_TONE[status]} className={className}>
      {t(status)}
    </StatusBadge>
  );
}
