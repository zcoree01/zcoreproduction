import { useTranslations } from "next-intl";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import type { BillingState } from "@/modules/platform/billing-queries";

const TONES: Record<BillingState, StatusTone> = {
  trial: "info",
  active: "success",
  warning: "warning",
  overdue: "danger",
  locked: "danger",
};

export function BillingStateBadge({ state }: { state: BillingState }) {
  const t = useTranslations("platform.billing.states");
  return <StatusBadge tone={TONES[state]}>{t(state)}</StatusBadge>;
}
