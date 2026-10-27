"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveIcon, PencilIcon, PlusIcon, RotateCcwIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  saveCrewAction,
  setCrewArchivedAction,
  type CrewActionResult,
} from "@/modules/attendance/schedule-actions";
import type { Crew, ScheduleEmployee } from "@/modules/attendance/schedule-queries";
import {
  crewSchema,
  type CrewFormValues,
  type CrewInput,
} from "@/modules/attendance/schedule-schemas";

type FormError = Extract<CrewActionResult, { ok: false }>["error"];

export function CrewsPanel({
  crews,
  employees,
  canManage,
}: {
  crews: Crew[];
  employees: ScheduleEmployee[];
  canManage: boolean;
}) {
  const t = useTranslations("crews");
  const [editing, setEditing] = useState<Crew | "new" | null>(null);
  const [archiving, setArchiving] = useState<Crew | null>(null);
  const [, startTransition] = useTransition();
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));

  const restore = (crew: Crew) =>
    startTransition(async () => {
      const result = await setCrewArchivedAction(crew.id, false);
      if (result.ok) toast.success(t("crewRestoredToast", { name: crew.name }));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("crewsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("crewsDescription")}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("addCrew")}
          </Button>
        ) : null}
      </div>
      {crews.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={t("crewsEmptyTitle")}
          description={t("crewsEmptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.crew")}</TableHead>
                <TableHead>{t("columns.members")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crews.map((crew) => (
                <TableRow key={crew.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      style={
                        crew.color ? { borderColor: crew.color, color: crew.color } : undefined
                      }
                    >
                      {crew.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {crew.employeeIds.length === 0 ? (
                      <span className="text-muted-foreground">{t("noMembers")}</span>
                    ) : (
                      crew.employeeIds.map((id) => names.get(id) ?? "—").join(", ")
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={crew.archived ? "neutral" : "success"}>
                      {crew.archived ? t("status.archived") : t("status.active")}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        {crew.archived ? (
                          <Button variant="ghost" size="sm" onClick={() => restore(crew)}>
                            <RotateCcwIcon />
                            {t("restore")}
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("editCrew", { name: crew.name })}
                              onClick={() => setEditing(crew)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("archiveCrew", { name: crew.name })}
                              onClick={() => setArchiving(crew)}
                            >
                              <ArchiveIcon />
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {editing !== null ? (
            <CrewForm
              key={editing === "new" ? "new" : editing.id}
              crew={editing === "new" ? null : editing}
              employees={employees}
              crews={crews}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archiveCrewTitle", { name: archiving?.name ?? "" })}
        description={t("archiveCrewDescription")}
        confirmLabel={t("archiveConfirm")}
        destructive
        onConfirm={async () => {
          if (!archiving) return;
          const result = await setCrewArchivedAction(archiving.id, true);
          if (result.ok) toast.success(t("crewArchivedToast", { name: archiving.name }));
          else toast.error(t(`errors.${result.error}`));
        }}
      />
    </section>
  );
}

function CrewForm({
  crew,
  employees,
  crews,
  onDone,
}: {
  crew: Crew | null;
  employees: ScheduleEmployee[];
  crews: Crew[];
  onDone: () => void;
}) {
  const t = useTranslations("crews");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const form = useForm<CrewFormValues, unknown, CrewInput>({
    resolver: zodResolver(crewSchema),
    defaultValues: {
      name: crew?.name ?? "",
      color: crew?.color ?? "",
      employeeIds: crew?.employeeIds ?? [],
    },
  });
  const otherCrew = new Map(
    crews
      .filter((item) => item.id !== crew?.id && !item.archived)
      .flatMap((item) => item.employeeIds.map((id) => [id, item.name] as const)),
  );
  const needle = search.trim().toLocaleLowerCase("bs");
  const visible = needle
    ? employees.filter((employee) => employee.name.toLocaleLowerCase("bs").includes(needle))
    : employees;

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await saveCrewAction(crew?.id ?? null, values);
      if (result.ok) {
        toast.success(
          t(crew ? "crewUpdatedToast" : "crewCreatedToast", { name: values.name.trim() }),
        );
        onDone();
        return;
      }
      if (result.error === "duplicate_name") {
        form.setError("name", { type: "server", message: t("errors.duplicate_name") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {crew ? t("editCrewTitle", { name: crew.name }) : t("createCrewTitle")}
        </SheetTitle>
        <SheetDescription>{t("crewFormDescription")}</SheetDescription>
      </SheetHeader>
      <form id="crew-form" onSubmit={onSubmit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="crew-name">{t("fields.name")}</FieldLabel>
                <Input
                  {...field}
                  id="crew-name"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? (
                  <FieldError>
                    {fieldState.error?.type === "server" && fieldState.error.message
                      ? fieldState.error.message
                      : t("fieldErrors.name")}
                  </FieldError>
                ) : null}
              </Field>
            )}
          />
          <Controller
            name="color"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="crew-color">{t("fields.color")}</FieldLabel>
                <input
                  id="crew-color"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded-md border bg-transparent"
                  value={field.value || "#64748b"}
                  onChange={(event) => field.onChange(event.target.value)}
                />
              </Field>
            )}
          />
          <Controller
            name="employeeIds"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="crew-search">
                  {t("fields.members", { count: field.value.length })}
                </FieldLabel>
                <Input
                  id="crew-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("searchEmployees")}
                />
                <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                  {visible.map((employee) => {
                    const checked = field.value.includes(employee.id);
                    const elsewhere = otherCrew.get(employee.id);
                    return (
                      <li key={employee.id}>
                        <label className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              field.onChange(
                                value === true
                                  ? [...field.value, employee.id]
                                  : field.value.filter((id) => id !== employee.id),
                              )
                            }
                          />
                          <span className="flex-1">{employee.name}</span>
                          {elsewhere && !checked ? (
                            <span className="text-xs text-muted-foreground">{elsewhere}</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">{t("moveHint")}</p>
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="crew-form" disabled={pending}>
          {pending ? t("submitting") : crew ? t("submitEdit") : t("submitCreateCrew")}
        </Button>
      </SheetFooter>
    </>
  );
}
