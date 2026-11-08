"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDecimal } from "@/lib/decimal";
import { assignPackageAction, setOrgBillingAction } from "@/modules/platform/billing-actions";

/** Package of a firm, its own grace days (empty = platform default) and automatic locking. */
export function PackageCard({
  organizationId,
  packages,
  packageId,
  monthlyPrice,
  graceDays,
  defaultGraceDays,
  autoLock,
}: {
  organizationId: string;
  /** Packages that can be chosen (not archived), plus the current one. */
  packages: { id: string; name: string }[];
  packageId: string | null;
  monthlyPrice: string | null;
  graceDays: number | null;
  defaultGraceDays: number;
  autoLock: boolean;
}) {
  const t = useTranslations("platform.billing.packageCard");
  const tb = useTranslations("platform.billing");
  const tErrors = useTranslations("platform.billing.errors");
  const [grace, setGrace] = useState(graceDays === null ? "" : String(graceDays));
  const [auto, setAuto] = useState(autoLock);
  const [pending, startTransition] = useTransition();
  const dirty = grace !== (graceDays === null ? "" : String(graceDays)) || auto !== autoLock;

  const assign = (next: string) =>
    startTransition(async () => {
      const result = await assignPackageAction({ organizationId, packageId: next });
      if (result.ok) toast.success(t("packageToast"));
      else toast.error(tErrors(result.error));
    });

  const save = () =>
    startTransition(async () => {
      const result = await setOrgBillingAction({
        organizationId,
        graceDays: grace,
        autoLock: auto,
      });
      if (result.ok) toast.success(t("savedToast"));
      else toast.error(tErrors(result.error));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="billing-package">{t("package")}</FieldLabel>
            <NativeSelect
              id="billing-package"
              value={packageId ?? ""}
              disabled={pending}
              onChange={(event) => assign(event.target.value)}
            >
              <NativeSelectOption value="">{t("none")}</NativeSelectOption>
              {packages.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <p className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("monthly")}</span>
            <span className="font-medium tabular-nums">
              {monthlyPrice
                ? tb("amount", { amount: formatDecimal(monthlyPrice) })
                : tb("noPackage")}
            </span>
          </p>
          <Field>
            <FieldLabel htmlFor="billing-grace">{t("grace")}</FieldLabel>
            <Input
              id="billing-grace"
              inputMode="numeric"
              value={grace}
              onChange={(event) => setGrace(event.target.value)}
              className="w-24"
            />
            <FieldDescription>{t("graceDefault", { days: defaultGraceDays })}</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="billing-auto-lock"
              checked={auto}
              onCheckedChange={(checked) => setAuto(checked === true)}
            />
            <FieldLabel htmlFor="billing-auto-lock">{t("autoLock")}</FieldLabel>
          </Field>
          <div>
            <Button variant="outline" disabled={pending || !dirty} onClick={save}>
              {t("save")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
