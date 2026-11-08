"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDecimal } from "@/lib/decimal";
import { assignPackageAction, setOrgBillingAction } from "@/modules/platform/billing-actions";
import type { OrganizationBilling } from "@/modules/platform/billing-queries";
import { modulesLost } from "@/modules/platform/schemas";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Package of a firm (mockup B): package, monthly amount, grace days (from the
 * settings or the firm's own) and automatic locking. A smaller package or none
 * asks first which modules the firm loses.
 */
export function PackageCard({
  organizationId,
  packages,
  packageId,
  monthlyPrice,
  graceDays,
  defaultGraceDays,
  autoLock,
  modules,
}: {
  organizationId: string;
  /** Packages that can be chosen (not archived, plus the current one) with their modules. */
  packages: { id: string; name: string; modules: string[] }[];
  packageId: string | null;
  monthlyPrice: string | null;
  graceDays: number | null;
  defaultGraceDays: number;
  autoLock: boolean;
  modules: OrganizationBilling["modules"];
}) {
  const t = useTranslations("platform.billing.packageCard");
  const tb = useTranslations("platform.billing");
  const tErrors = useTranslations("platform.billing.errors");
  const tModule = useTranslations("moduleNames");
  const [pending, startTransition] = useTransition();
  const [editingGrace, setEditingGrace] = useState(false);
  const [grace, setGrace] = useState(graceDays === null ? "" : String(graceDays));
  const [losing, setLosing] = useState<{ next: string; modules: string[] } | null>(null);

  const assign = (next: string) =>
    startTransition(async () => {
      const result = await assignPackageAction({ organizationId, packageId: next });
      if (result.ok) toast.success(t("packageToast"));
      else toast.error(tErrors(result.error));
      setLosing(null);
    });

  const choose = (next: string) => {
    const chosen = packages.find((p) => p.id === next);
    const lost = modulesLost(modules, chosen ? chosen.modules : null);
    if (lost.length > 0) setLosing({ next, modules: lost });
    else assign(next);
  };

  const saveBilling = (nextGrace: string, nextAuto: boolean) =>
    startTransition(async () => {
      const result = await setOrgBillingAction({
        organizationId,
        graceDays: nextGrace,
        autoLock: nextAuto,
      });
      if (result.ok) {
        toast.success(t("savedToast"));
        setEditingGrace(false);
      } else {
        toast.error(tErrors(result.error));
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <Row label={t("package")}>
          <NativeSelect
            aria-label={t("package")}
            value={packageId ?? ""}
            disabled={pending}
            onChange={(event) => choose(event.target.value)}
            className="min-w-48"
          >
            <NativeSelectOption value="">{t("none")}</NativeSelectOption>
            {packages.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Row>
        <Row label={t("monthly")}>
          <span className="font-medium tabular-nums">
            {monthlyPrice ? tb("amount", { amount: formatDecimal(monthlyPrice) }) : tb("noPackage")}
          </span>
        </Row>
        <Row label={t("graceShort")}>
          {editingGrace ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveBilling(grace, autoLock);
              }}
            >
              <Input
                aria-label={t("graceInput")}
                inputMode="numeric"
                value={grace}
                onChange={(event) => setGrace(event.target.value)}
                className="w-20"
                autoFocus
              />
              <Button type="submit" size="sm" disabled={pending}>
                {t("graceSave")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGrace(graceDays === null ? "" : String(graceDays));
                  setEditingGrace(false);
                }}
              >
                {t("graceCancel")}
              </Button>
            </form>
          ) : (
            <>
              <span>
                {graceDays === null
                  ? t("graceFromSettings", { days: defaultGraceDays })
                  : t("graceOwn", { days: graceDays })}
              </span>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setEditingGrace(true)}
              >
                {t("changeGrace")}
              </button>
              {graceDays !== null ? (
                <>
                  <span aria-hidden>·</span>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    disabled={pending}
                    onClick={() => saveBilling("", autoLock)}
                  >
                    {t("useDefault")}
                  </button>
                </>
              ) : null}
            </>
          )}
        </Row>
        <Row label={t("autoLock")}>
          <NativeSelect
            aria-label={t("autoLock")}
            value={autoLock ? "on" : "off"}
            disabled={pending}
            onChange={(event) =>
              saveBilling(graceDays === null ? "" : String(graceDays), event.target.value === "on")
            }
          >
            <NativeSelectOption value="on">{t("autoOn")}</NativeSelectOption>
            <NativeSelectOption value="off">{t("autoOff")}</NativeSelectOption>
          </NativeSelect>
        </Row>
      </CardContent>
      <ConfirmDialog
        open={losing !== null}
        onOpenChange={(open) => !open && setLosing(null)}
        title={t("loseTitle")}
        description={
          losing
            ? t("loseDescription", {
                modules: losing.modules.map((key) => tModule(key as "core")).join(", "),
              })
            : ""
        }
        confirmLabel={t("loseConfirm")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          if (losing) assign(losing.next);
        }}
      />
    </Card>
  );
}
