"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { setOrganizationModuleAction } from "@/modules/platform/actions";
import type { OrganizationBilling } from "@/modules/platform/billing-queries";
import { SELLABLE_MODULES } from "@/modules/platform/modules";

type Module = OrganizationBilling["modules"][number];

/**
 * Modules of a firm (mockup B): one row each with where it comes from — the
 * package, a trial until a day, switched on by hand, or not in the package —
 * and one action: add as a trial, remove the trial, switch off.
 */
export function ModulesCard({
  organizationId,
  modules,
  today,
}: {
  organizationId: string;
  modules: Module[];
  /** Today in the platform's time zone (smallest trial end). */
  today: string;
}) {
  const t = useTranslations("platform.billing.modulesCard");
  const tModule = useTranslations("moduleNames");
  const tErrors = useTranslations("platform.billing.errors");
  const format = useFormatter();
  const [trialFor, setTrialFor] = useState<Module | null>(null);
  const [until, setUntil] = useState("");
  const [pending, startTransition] = useTransition();
  const name = (key: string) => (tModule.has(key as "core") ? tModule(key as "core") : key);

  const save = (module: Module, enabled: boolean, activeUntil: string, success: string) =>
    startTransition(async () => {
      const result = await setOrganizationModuleAction({
        organizationId,
        module: module.key,
        enabled,
        activeUntil,
      });
      if (result.ok) {
        toast.success(success);
        setTrialFor(null);
      } else {
        toast.error(tErrors(result.error));
      }
    });

  const badge = (module: Module): { tone: StatusTone; label: string } => {
    if (module.source === "package") return { tone: "success", label: t("source.package") };
    if (module.source === "trial" && module.activeUntil) {
      return {
        tone: "info",
        label: t("trialUntil", {
          date: format.dateTime(new Date(module.activeUntil), {
            dateStyle: "medium",
            timeZone: "Europe/Sarajevo",
          }),
        }),
      };
    }
    if (module.source === "manual") return { tone: "neutral", label: t("on") };
    return { tone: "neutral", label: t("source.off") };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {[...modules]
            // Same order as in the package form (mockup B).
            .sort(
              (a, b) =>
                SELLABLE_MODULES.indexOf(a.key as "production") -
                SELLABLE_MODULES.indexOf(b.key as "production"),
            )
            .map((module) => {
              const { tone, label } = badge(module);
              return (
                <li
                  key={module.key}
                  className="flex min-h-11 items-center gap-2 py-1.5 text-sm"
                  data-testid={`module-${module.key}`}
                >
                  <span className="flex-1">{name(module.key)}</span>
                  <StatusBadge tone={tone}>{label}</StatusBadge>
                  <div className="w-36 text-right">
                    {module.source === "off" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setUntil("");
                          setTrialFor(module);
                        }}
                      >
                        {t("addTrial")}
                      </Button>
                    ) : module.source === "trial" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          save(module, false, "", t("offToast", { module: name(module.key) }))
                        }
                      >
                        {t("removeTrial")}
                      </Button>
                    ) : module.source === "manual" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          save(module, false, "", t("offToast", { module: name(module.key) }))
                        }
                      >
                        {t("turnOff")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
        </ul>
      </CardContent>
      <Sheet open={trialFor !== null} onOpenChange={(open) => !open && setTrialFor(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>
              {trialFor ? t("trialTitle", { module: name(trialFor.key) }) : null}
            </SheetTitle>
            <SheetDescription>{t("trialDescription")}</SheetDescription>
          </SheetHeader>
          <form
            id="module-trial-form"
            className="flex-1 overflow-y-auto p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (trialFor && until) {
                save(trialFor, true, until, t("trialToast", { module: name(trialFor.key) }));
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="module-trial-until">{t("trialUntilLabel")}</FieldLabel>
                <Input
                  id="module-trial-until"
                  type="date"
                  required
                  min={today}
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </form>
          <SheetFooter className="border-t">
            <Button type="submit" form="module-trial-form" disabled={pending || until === ""}>
              {t("trialSave")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
