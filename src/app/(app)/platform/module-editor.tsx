"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { setOrganizationModuleAction } from "@/modules/platform/actions";
import type { PlatformModule } from "@/modules/platform/queries";
import { moduleState } from "@/modules/platform/schemas";

const TONES = { off: "neutral", on: "success", trial: "info", expired: "danger" } as const;

/** One module of one organization: on/off and the last day of the trial ("" = no end). */
export function ModuleEditor({
  organizationId,
  module,
  initialUntilDay,
}: {
  organizationId: string;
  module: PlatformModule;
  /** activeUntil as a calendar day in the platform's time zone. */
  initialUntilDay: string;
}) {
  const t = useTranslations("platform.modules");
  const tModule = useTranslations("moduleNames");
  // Modules added later show their key until they get a name.
  const label =
    module.key === "production" || module.key === "attendance" ? tModule(module.key) : module.key;
  const router = useRouter();
  const [enabled, setEnabled] = useState(module.enabled);
  const [until, setUntil] = useState(initialUntilDay);
  const [pending, startTransition] = useTransition();
  const state = moduleState(module);
  const dirty = enabled !== module.enabled || until !== initialUntilDay;

  const save = () =>
    startTransition(async () => {
      const result = await setOrganizationModuleAction({
        organizationId,
        module: module.key,
        enabled,
        activeUntil: until,
      });
      if (result.ok) {
        toast.success(t("savedToast", { module: label }));
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <label className="flex min-w-40 items-center gap-2 text-sm font-medium">
        <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked)} />
        {label}
      </label>
      <StatusBadge tone={TONES[state.state]}>
        {state.state === "trial"
          ? t("trialLeft", { days: state.daysLeft ?? 0 })
          : t(`state.${state.state}`)}
      </StatusBadge>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("until")}
        <Input
          type="date"
          value={until}
          disabled={!enabled}
          onChange={(event) => setUntil(event.target.value)}
          className="h-8 w-40"
          aria-label={t("untilLabel", { module: label })}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={!dirty || pending}
        onClick={save}
      >
        {pending ? t("saving") : t("save")}
      </Button>
    </div>
  );
}
