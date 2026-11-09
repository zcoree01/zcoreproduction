"use client";

import { CopyIcon, PlusIcon, ShieldIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PermissionKey } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { archiveRoleAction, saveRoleAction } from "@/modules/roles/actions";
import type { PermissionInfo, RoleWithPermissions } from "@/modules/roles/queries";

type Role = RoleWithPermissions & { label: string };
type Draft = { id: string | null; name: string; permissions: PermissionKey[] };

const MODULE_ORDER = [
  "platform",
  "core",
  "production",
  "planning",
  "reports",
  "attendance",
  "inventory",
  "finished_goods",
  "tools",
  "kiosk",
  "payroll",
] as const;
const messageKey = (key: PermissionKey) => key.replace(/\./g, "_");

/**
 * Role list on the left, the chosen role on the right: system roles are
 * read-only (copy them), custom roles get a name and permissions by module.
 */
export function RoleEditor({
  roles,
  permissions,
  enabledModules,
  selectedId,
}: {
  roles: Role[];
  permissions: PermissionInfo[];
  enabledModules: string[];
  selectedId: string | null;
}) {
  const t = useTranslations("rolesEditor");
  const router = useRouter();
  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Draft | null>(
    selected && !selected.isSystem
      ? { id: selected.id, name: selected.name, permissions: selected.permissions }
      : null,
  );
  const [shownFor, setShownFor] = useState(selectedId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Another role chosen in the URL: start its draft.
  if (shownFor !== selectedId) {
    setShownFor(selectedId);
    setError(null);
    setDraft(
      selected && !selected.isSystem
        ? { id: selected.id, name: selected.name, permissions: selected.permissions }
        : null,
    );
  }

  const grantable = new Set<string>(permissions.map((p) => p.key));
  const editing = draft !== null;
  const shown: PermissionKey[] = draft ? draft.permissions : (selected?.permissions ?? []);
  const dirty =
    draft !== null &&
    (draft.id === null ||
      draft.name !== selected?.name ||
      [...draft.permissions].sort().join() !== [...(selected?.permissions ?? [])].sort().join());

  const toggle = (keys: PermissionKey[], on: boolean) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            permissions: on
              ? [...new Set([...current.permissions, ...keys])]
              : current.permissions.filter((key) => !keys.includes(key)),
          }
        : current,
    );

  const save = () =>
    startTransition(async () => {
      if (!draft) return;
      setError(null);
      const result = await saveRoleAction(draft.id, {
        name: draft.name,
        permissions: draft.permissions,
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("saved", { name: draft.name.trim() }));
      if (draft.id === null) router.push(`/settings/roles?role=${result.id}`);
      else setDraft({ ...draft, name: draft.name.trim() });
    });

  const byModule = MODULE_ORDER.map((module) => ({
    module,
    items: permissions.filter((p) => p.module === module),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="self-start">
        <CardContent className="flex flex-col gap-1 p-2">
          <Button
            variant="outline"
            className="mb-2 justify-start"
            onClick={() => {
              setError(null);
              setDraft({ id: null, name: t("newName"), permissions: [] });
            }}
          >
            <PlusIcon />
            {t("newRole")}
          </Button>
          <nav aria-label={t("title")} className="flex flex-col gap-0.5">
            {roles.map((role) => (
              <Link
                key={role.id}
                href={`/settings/roles?role=${role.id}`}
                aria-current={role.id === selectedId && draft?.id !== null ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                  role.id === selectedId && draft?.id !== null && "bg-muted font-medium",
                )}
                data-testid="role-link"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {role.isSystem ? (
                    <ShieldIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                  <span className="truncate">{role.label}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t("members", { count: role.members })}
                </span>
              </Link>
            ))}
          </nav>
        </CardContent>
      </Card>

      {selected || draft ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2">
                {draft ? draft.name || t("newName") : selected?.label}
                <Badge variant={editing ? "secondary" : "outline"}>
                  {editing ? t("custom") : t("system")}
                </Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("permissionsCount", { count: shown.length })}
                {selected && draft?.id !== null
                  ? ` · ${t("members", { count: selected.members })}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected && draft?.id !== null ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setDraft({
                      id: null,
                      name: t("copyName", { name: selected.label }),
                      permissions: selected.permissions.filter((key) => grantable.has(key)),
                    });
                  }}
                >
                  <CopyIcon />
                  {t("copy")}
                </Button>
              ) : null}
              {draft?.id && selected && !selected.isSystem ? (
                <ConfirmDialog
                  trigger={<Button variant="outline">{t("archive")}</Button>}
                  title={t("archiveTitle", { name: selected.name })}
                  description={selected.members > 0 ? t("archiveInUse") : t("archiveDescription")}
                  confirmLabel={t("archive")}
                  destructive
                  onConfirm={async () => {
                    const result = await archiveRoleAction(selected.id);
                    if (!result.ok) {
                      toast.error(t(`errors.${result.error}`));
                      return;
                    }
                    toast.success(t("archived", { name: selected.name }));
                    router.push("/settings/roles");
                  }}
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {draft ? (
              <Field className="max-w-md">
                <FieldLabel htmlFor="role-name">{t("name")}</FieldLabel>
                <Input
                  id="role-name"
                  value={draft.name}
                  maxLength={100}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
            ) : (
              <Alert>
                <ShieldIcon />
                <AlertDescription>{t("systemHint")}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              {byModule.map(({ module, items }) => {
                const off = module !== "core" && !enabledModules.includes(module);
                const keys = items.map((item) => item.key);
                return (
                  <fieldset
                    key={module}
                    className="flex flex-col gap-2 rounded-lg border p-3"
                    data-testid={`role-module-${module}`}
                  >
                    <legend className="flex w-full items-center justify-between gap-2 px-1 text-sm font-medium">
                      <span>
                        {t(`modules.${module}`)}
                        {off ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {t("moduleOff")}
                          </span>
                        ) : null}
                      </span>
                      {draft ? (
                        <span className="flex gap-1">
                          <Button variant="ghost" size="xs" onClick={() => toggle(keys, true)}>
                            {t("selectAll")}
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => toggle(keys, false)}>
                            {t("selectNone")}
                          </Button>
                        </span>
                      ) : null}
                    </legend>
                    {items.map((item) => {
                      const id = `permission-${messageKey(item.key)}`;
                      const hint = t(
                        `permissions.${messageKey(item.key)}.hint` as "permissions.orders_read.hint",
                      );
                      return (
                        <Field key={item.key} orientation="horizontal">
                          <Checkbox
                            id={id}
                            checked={shown.includes(item.key)}
                            disabled={!draft}
                            onCheckedChange={(checked) => toggle([item.key], checked === true)}
                          />
                          <div className="flex flex-col gap-0.5">
                            <FieldLabel htmlFor={id}>
                              {t(
                                `permissions.${messageKey(item.key)}.label` as "permissions.orders_read.label",
                              )}
                            </FieldLabel>
                            {hint ? <FieldDescription>{hint}</FieldDescription> : null}
                          </div>
                        </Field>
                      );
                    })}
                  </fieldset>
                );
              })}
            </div>

            {draft ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={save} disabled={pending || draft.name.trim() === "" || !dirty}>
                  {t("save")}
                </Button>
                {dirty ? (
                  <span className="text-sm text-muted-foreground">{t("unsaved")}</span>
                ) : null}
                {draft.id === null && selected ? (
                  <Link
                    href={`/settings/roles?role=${selected.id}`}
                    className={buttonVariants({ variant: "ghost" })}
                    onClick={() =>
                      setDraft(
                        selected.isSystem
                          ? null
                          : {
                              id: selected.id,
                              name: selected.name,
                              permissions: selected.permissions,
                            },
                      )
                    }
                  >
                    {/* Back to the role that was shown. */}
                    {selected.label}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
