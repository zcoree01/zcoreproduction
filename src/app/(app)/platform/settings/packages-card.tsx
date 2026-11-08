"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { savePackageAction, setPackageArchivedAction } from "@/modules/platform/billing-actions";
import type { BillingPackage } from "@/modules/platform/billing-queries";
import { SELLABLE_MODULES } from "@/modules/platform/modules";
import { toggleModule, type ModuleDependency } from "@/modules/platform/schemas";

/** Packages: list, new / change (name, monthly price, modules), archive / restore. */
export function PackagesCard({
  packages,
  dependencies,
}: {
  packages: BillingPackage[];
  dependencies: ModuleDependency[];
}) {
  const t = useTranslations("platform.billing.packages");
  const tb = useTranslations("platform.billing");
  const tErrors = useTranslations("platform.billing.errors");
  const tModule = useTranslations("moduleNames");
  const format = useFormatter();
  const [editing, setEditing] = useState<BillingPackage | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  const archive = (pkg: BillingPackage) =>
    startTransition(async () => {
      const result = await setPackageArchivedAction(pkg.id, !pkg.archived);
      if (result.ok) toast.success(t(pkg.archived ? "restoredToast" : "archivedToast"));
      else toast.error(tErrors(result.error));
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon />
          {t("add")}
        </Button>
      </CardHeader>
      <CardContent>
        {packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead className="text-right">{t("columns.monthly")}</TableHead>
                  <TableHead>{t("columns.modules")}</TableHead>
                  <TableHead className="text-right">{t("columns.firms")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow key={pkg.id} className={cn(pkg.archived && "text-muted-foreground")}>
                    <TableCell className="font-medium">
                      {pkg.name}
                      {pkg.archived ? (
                        <span className="ml-2 text-xs">({t("archived")})</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pkg.monthlyPrice
                        ? tb("amount", { amount: formatDecimal(pkg.monthlyPrice) })
                        : "—"}
                      {pkg.nextMonthlyPrice ? (
                        <div className="text-xs text-muted-foreground">
                          {t("nextPrice", {
                            amount: formatDecimal(pkg.nextMonthlyPrice),
                            date: format.dateTime(new Date(`${pkg.nextFrom}T12:00:00Z`), {
                              dateStyle: "medium",
                            }),
                          })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pkg.modules.map((key) => tModule(key as "production")).join(", ")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pkg.organizationCount}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {!pkg.archived ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("edit")}
                          onClick={() => setEditing(pkg)}
                        >
                          <PencilIcon />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => archive(pkg)}
                      >
                        {t(pkg.archived ? "restore" : "archive")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <PackageSheet
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        pkg={editing}
        dependencies={dependencies}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

function PackageSheet({
  pkg,
  dependencies,
  onClose,
}: {
  pkg: BillingPackage | "new" | null;
  dependencies: ModuleDependency[];
  onClose: () => void;
}) {
  const t = useTranslations("platform.billing.packages");
  const tErrors = useTranslations("platform.billing.errors");
  const tModule = useTranslations("moduleNames");
  const existing = pkg !== null && pkg !== "new" ? pkg : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [price, setPrice] = useState(existing?.nextMonthlyPrice ?? existing?.monthlyPrice ?? "");
  const [modules, setModules] = useState<string[]>(existing?.modules ?? []);
  const [invalid, setInvalid] = useState<"name" | "price" | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) return setInvalid("name");
    const amount = parseDecimal(price, 2);
    if (amount === null || amount.startsWith("-")) return setInvalid("price");
    setInvalid(null);
    startTransition(async () => {
      const result = await savePackageAction(existing?.id ?? null, {
        name: trimmed,
        monthlyPrice: price,
        modules,
      });
      if (result.ok) {
        toast.success(t("savedToast", { name: trimmed }));
        onClose();
      } else {
        toast.error(tErrors(result.error));
      }
    });
  };

  return (
    <Sheet open={pkg !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>
            {existing ? t("sheetEdit", { name: existing.name }) : t("sheetNew")}
          </SheetTitle>
        </SheetHeader>
        <form
          id="billing-package-form"
          className="flex-1 overflow-y-auto p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            <Field data-invalid={invalid === "name" || undefined}>
              <FieldLabel htmlFor="package-name">{t("name")}</FieldLabel>
              <Input
                id="package-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={invalid === "name" || undefined}
              />
              <FieldDescription>{t("nameHint")}</FieldDescription>
            </Field>
            <Field data-invalid={invalid === "price" || undefined}>
              <FieldLabel htmlFor="package-price">{t("monthly")}</FieldLabel>
              <Input
                id="package-price"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                aria-invalid={invalid === "price" || undefined}
                className="w-32"
              />
              {invalid === "price" ? <FieldError>{t("monthlyInvalid")}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel>{t("modules")}</FieldLabel>
              <FieldDescription>{t("modulesHint")}</FieldDescription>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked disabled />
                  {t("core")}
                </label>
                {SELLABLE_MODULES.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={modules.includes(key)}
                      onCheckedChange={(checked) =>
                        setModules((current) =>
                          toggleModule(current, key, checked === true, dependencies),
                        )
                      }
                    />
                    {tModule(key)}
                  </label>
                ))}
              </div>
            </Field>
          </FieldGroup>
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="billing-package-form" disabled={pending}>
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
