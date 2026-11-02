"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GripVerticalIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { resetDashboardLayoutAction, saveDashboardLayoutAction } from "@/modules/dashboard/actions";
import {
  moveWidget,
  WIDGET_KEYS,
  WIDGETS,
  type LayoutWidget,
  type WidgetGroup,
  type WidgetKey,
} from "@/modules/dashboard/widgets";

const GROUPS: WidgetGroup[] = ["production", "attendance", "inventory"];

/**
 * Widgets of one role's dashboard (D-037): add, remove, reorder (drag or
 * arrows) and size; saved for the role named next to the save button.
 */
export function LayoutEditor({
  roles,
  roleId,
  roleLabel,
  initialWidgets,
  custom,
  rolePermissions,
  modules,
}: {
  roles: { id: string; label: string }[];
  roleId: string;
  roleLabel: string;
  initialWidgets: LayoutWidget[];
  custom: boolean;
  rolePermissions: string[];
  modules: string[];
}) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [dirty, setDirty] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const permissions = new Set(rolePermissions);
  const enabled = new Set(modules);
  const included = new Set(widgets.map((widget) => widget.key));

  const change = (next: LayoutWidget[]) => {
    setWidgets(next);
    setDirty(true);
  };
  const move = (from: number, to: number) => change(moveWidget(widgets, from, to));
  const remove = (key: WidgetKey) => change(widgets.filter((widget) => widget.key !== key));
  const add = (key: WidgetKey) => change([...widgets, { key, size: WIDGETS[key].size }]);
  const resize = (key: WidgetKey) =>
    change(
      widgets.map((widget) =>
        widget.key === key
          ? { ...widget, size: widget.size === "wide" ? "normal" : "wide" }
          : widget,
      ),
    );

  const switchRole = (id: string) => {
    if (id === roleId) return;
    if (dirty) setPendingRole(id);
    else router.push(`/dashboard/edit?role=${id}`);
  };

  const errorText = (error: string) =>
    error === "denied"
      ? t("editor.errors.denied")
      : error === "invalid"
        ? t("editor.errors.invalid")
        : error === "not_found"
          ? t("editor.errors.not_found")
          : t("editor.errors.unexpected");

  const save = () =>
    startSaving(async () => {
      const result = await saveDashboardLayoutAction(roleId, widgets);
      if (!result.ok) {
        toast.error(errorText(result.error));
        return;
      }
      setDirty(false);
      toast.success(t("editor.saved", { role: roleLabel }));
    });

  const reset = async () => {
    const result = await resetDashboardLayoutAction(roleId);
    if (!result.ok) {
      toast.error(errorText(result.error));
      return;
    }
    toast.success(t("editor.resetDone", { role: roleLabel }));
    setDirty(false);
  };

  const warning = (key: WidgetKey): string | null => {
    const widget = WIDGETS[key];
    if (!enabled.has(widget.module)) return t("editor.moduleOff");
    if (!widget.permissions.some((permission) => permissions.has(permission))) {
      return t("editor.noPermission");
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3 shadow-xs">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("editor.role")}</span>
          <NativeSelect
            value={roleId}
            onChange={(event) => switchRole(event.target.value)}
            aria-label={t("editor.role")}
          >
            {roles.map((role) => (
              <NativeSelectOption key={role.id} value={role.id}>
                {role.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <span className="text-sm text-muted-foreground">
          {custom ? t("editor.customLayout") : t("editor.defaultLayout")}
          {dirty ? ` · ${t("editor.unsaved")}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href="/dashboard" className={buttonVariants({ variant: "ghost" })}>
            {t("editor.back")}
          </Link>
          {custom ? (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <RotateCcwIcon />
                  {t("editor.reset")}
                </Button>
              }
              title={t("editor.resetTitle", { role: roleLabel })}
              description={t("editor.resetDescription")}
              confirmLabel={t("editor.reset")}
              onConfirm={reset}
            />
          ) : null}
          <span className="text-sm">
            {t("editor.roleLabel")} <strong>{roleLabel}</strong>
          </span>
          <Button onClick={save} disabled={saving || !dirty}>
            {t("editor.save")}
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">
          {t("editor.layoutTitle", { role: roleLabel, count: widgets.length })}
        </h2>
        {widgets.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("editor.layoutEmpty")}
          </p>
        ) : (
          <ol className="grid grid-flow-row-dense gap-3 md:grid-cols-2 xl:grid-cols-3">
            {widgets.map((widget, index) => {
              const problem = warning(widget.key);
              return (
                <li
                  key={widget.key}
                  className={cn(
                    widget.size === "wide" && "md:col-span-2",
                    dragged === index && "opacity-50",
                  )}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragged(index);
                  }}
                  onDragOver={(event) => {
                    if (dragged === null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragged !== null && dragged !== index) move(dragged, index);
                    setDragged(null);
                  }}
                  onDragEnd={() => setDragged(null)}
                  data-testid={`layout-widget-${widget.key}`}
                >
                  <Card className="h-full">
                    <CardHeader className="flex flex-row items-start gap-2">
                      <GripVerticalIcon
                        className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground"
                        aria-hidden
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <CardTitle className="text-base">
                          {index + 1}. {t(`widgets.${widget.key}.title`)}
                        </CardTitle>
                        <CardDescription>{t(`widgets.${widget.key}.description`)}</CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => remove(widget.key)}
                        aria-label={t("editor.remove", {
                          widget: t(`widgets.${widget.key}.title`),
                        })}
                      >
                        <XIcon />
                      </Button>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0}
                        aria-label={t("editor.moveEarlier")}
                      >
                        <ArrowLeftIcon />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => move(index, index + 1)}
                        disabled={index === widgets.length - 1}
                        aria-label={t("editor.moveLater")}
                      >
                        <ArrowRightIcon />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => resize(widget.key)}>
                        {widget.size === "wide" ? t("editor.makeNormal") : t("editor.makeWide")}
                      </Button>
                      {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("editor.addTitle")}</h2>
        {WIDGET_KEYS.every((key) => included.has(key)) ? (
          <p className="text-sm text-muted-foreground">{t("editor.allAdded")}</p>
        ) : (
          GROUPS.map((group) => {
            const available = WIDGET_KEYS.filter(
              (key) => WIDGETS[key].group === group && !included.has(key),
            );
            if (available.length === 0) return null;
            return (
              <div key={group} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {t(`editor.groups.${group}`)}
                </h3>
                <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {available.map((key) => {
                    const problem = warning(key);
                    return (
                      <li
                        key={key}
                        className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-medium">{t(`widgets.${key}.title`)}</span>
                          <span className="text-muted-foreground">
                            {t(`widgets.${key}.description`)}
                          </span>
                          {problem ? (
                            <span className="text-xs text-destructive">{problem}</span>
                          ) : null}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => add(key)}
                          aria-label={t("editor.add", { widget: t(`widgets.${key}.title`) })}
                        >
                          <PlusIcon />
                          {t("editor.addShort")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRole(null);
        }}
        title={t("editor.discardTitle")}
        description={t("editor.discardDescription", { role: roleLabel })}
        confirmLabel={t("editor.discard")}
        destructive
        onConfirm={() => {
          const id = pendingRole;
          setPendingRole(null);
          if (id) router.push(`/dashboard/edit?role=${id}`);
        }}
      />
    </div>
  );
}
