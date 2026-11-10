import { useTranslations } from "next-intl";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import type { ProblemStatus } from "@/modules/support/problem-reports/schemas";
import type { SupportStatus } from "@/modules/support/schemas";

const REPORT_TONES: Record<ProblemStatus, StatusTone> = {
  new: "warning",
  in_progress: "info",
  waiting_user: "neutral",
  resolved: "success",
};

export function ReportStatusBadge({ status }: { status: ProblemStatus }) {
  const t = useTranslations("platformReports.statuses");
  return <StatusBadge tone={REPORT_TONES[status]}>{t(status)}</StatusBadge>;
}

const SESSION_TONES: Record<SupportStatus, StatusTone> = {
  pending: "warning",
  approved: "info",
  active: "success",
  rejected: "danger",
  ended: "neutral",
  cancelled: "neutral",
};

export function SessionStatusBadge({ status }: { status: SupportStatus }) {
  const t = useTranslations("support.status");
  return <StatusBadge tone={SESSION_TONES[status]}>{t(status)}</StatusBadge>;
}
