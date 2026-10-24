"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveIcon, LayersIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { useState, useTransition, type ComponentProps } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { formatDecimal } from "@/lib/decimal";
import {
  saveMaterialAction,
  saveMaterialGroupAction,
  setMaterialArchivedAction,
} from "@/modules/materials/actions";
import type { MaterialGroup } from "@/modules/materials/queries";
import {
  materialGroupSchema,
  materialSchema,
  type MaterialFormValues,
  type MaterialGroupFormValues,
} from "@/modules/materials/schemas";

type Material = MaterialGroup["materials"][number];
type Editing =
  | { kind: "group"; group: MaterialGroup | null }
  | { kind: "material"; groupId: string; material: Material | null };

export function MaterialList({ groups }: { groups: MaterialGroup[] }) {
  const t = useTranslations("materials");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();
  const visibleGroups = groups.filter((group) => showArchived || !group.archived);
  const activeGroups = groups.filter((group) => !group.archived);

  const setArchived = (kind: "group" | "material", id: string, name: string, archived: boolean) =>
    startTransition(async () => {
      const result = await setMaterialArchivedAction(kind, id, archived);
      if (result.ok) toast.success(t(archived ? "archivedToast" : "restoredToast", { name }));
      else toast.error(t(`errors.${result.error}`));
    });

  const density = (value: string | null) =>
    value ? t("densityValue", { value: formatDecimal(value) }) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={showArchived}
            onCheckedChange={(value) => setShowArchived(value === true)}
          />
          {t("showArchived")}
        </Label>
        <Button onClick={() => setEditing({ kind: "group", group: null })}>
          <PlusIcon />
          {t("addGroup")}
        </Button>
      </div>

      {visibleGroups.length === 0 ? (
        <EmptyState
          icon={<LayersIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : null}

      {visibleGroups.map((group) => {
        const materials = group.materials.filter((material) => showArchived || !material.archived);
        return (
          <Card key={group.id} className={group.archived ? "opacity-70" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {group.name}
                {group.archived ? <Badge variant="secondary">{t("archivedBadge")}</Badge> : null}
              </CardTitle>
              <CardDescription>{density(group.density) ?? t("noDensity")}</CardDescription>
              <CardAction className="flex gap-1">
                {group.archived ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setArchived("group", group.id, group.name, false)}
                  >
                    <RotateCcwIcon />
                    {t("restore")}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEditing({ kind: "material", groupId: group.id, material: null })
                      }
                    >
                      <PlusIcon />
                      {t("addMaterial")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("edit", { name: group.name })}
                      onClick={() => setEditing({ kind: "group", group })}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      aria-label={t("archive", { name: group.name })}
                      onClick={() => setArchived("group", group.id, group.name, true)}
                    >
                      <ArchiveIcon />
                    </Button>
                  </>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              {materials.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("groupEmpty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.designation")}</TableHead>
                      <TableHead>{t("columns.density")}</TableHead>
                      <TableHead>
                        <span className="sr-only">{t("columns.actions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materials.map((material) => (
                      <TableRow
                        key={material.id}
                        className={material.archived ? "opacity-60" : undefined}
                      >
                        <TableCell className="font-medium">
                          {material.designation}
                          {material.archived ? (
                            <Badge variant="secondary" className="ml-2">
                              {t("archivedBadge")}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {density(material.density) ?? (
                            <span className="text-muted-foreground">
                              {group.density
                                ? t("fromGroup", { value: formatDecimal(group.density) })
                                : "—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {material.archived ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pending || group.archived}
                                onClick={() =>
                                  setArchived("material", material.id, material.designation, false)
                                }
                              >
                                <RotateCcwIcon />
                                {t("restore")}
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("edit", { name: material.designation })}
                                  onClick={() =>
                                    setEditing({ kind: "material", groupId: group.id, material })
                                  }
                                >
                                  <PencilIcon />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={pending}
                                  aria-label={t("archive", { name: material.designation })}
                                  onClick={() =>
                                    setArchived("material", material.id, material.designation, true)
                                  }
                                >
                                  <ArchiveIcon />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {editing?.kind === "group" ? (
            <GroupForm
              key={editing.group?.id ?? "new"}
              group={editing.group}
              onDone={() => setEditing(null)}
            />
          ) : editing?.kind === "material" ? (
            <MaterialForm
              key={editing.material?.id ?? `new-${editing.groupId}`}
              groups={activeGroups}
              groupId={editing.groupId}
              material={editing.material}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function GroupForm({ group, onDone }: { group: MaterialGroup | null; onDone: () => void }) {
  const t = useTranslations("materials");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<MaterialGroupFormValues, unknown, z.output<typeof materialGroupSchema>>({
    resolver: zodResolver(materialGroupSchema),
    defaultValues: { name: group?.name ?? "", density: formatDecimal(group?.density) },
  });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await saveMaterialGroupAction(group?.id ?? null, values);
      if (result.ok) {
        toast.success(t("savedToast", { name: values.name.trim() }));
        onDone();
      } else if (result.error === "name_taken") {
        form.setError("name", { type: "server", message: t("errors.name_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(t(`errors.${result.error}`));
      }
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{group ? t("editGroupTitle", { name: group.name }) : t("addGroup")}</SheetTitle>
        <SheetDescription>{t("groupDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="material-group-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="material-group-name">{t("fields.groupName")}</FieldLabel>
                <Input
                  {...field}
                  id="material-group-name"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? (
                  <FieldError>{fieldState.error?.message || t("fieldErrors.name")}</FieldError>
                ) : null}
              </Field>
            )}
          />
          <Controller
            name="density"
            control={form.control}
            render={({ field, fieldState }) => (
              <DensityInput {...field} invalid={fieldState.invalid} hint={t("groupDensityHint")} />
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="material-group-form" disabled={pending}>
          {pending ? t("submitting") : t("save")}
        </Button>
      </SheetFooter>
    </>
  );
}

function MaterialForm({
  groups,
  groupId,
  material,
  onDone,
}: {
  groups: MaterialGroup[];
  groupId: string;
  material: Material | null;
  onDone: () => void;
}) {
  const t = useTranslations("materials");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<MaterialFormValues, unknown, z.output<typeof materialSchema>>({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      groupId,
      designation: material?.designation ?? "",
      density: formatDecimal(material?.density),
    },
  });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await saveMaterialAction(material?.id ?? null, values);
      if (result.ok) {
        toast.success(t("savedToast", { name: values.designation.trim() }));
        onDone();
      } else if (result.error === "designation_taken") {
        form.setError("designation", { type: "server", message: t("errors.designation_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(t(`errors.${result.error}`));
      }
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {material ? t("editMaterialTitle", { name: material.designation }) : t("addMaterial")}
        </SheetTitle>
        <SheetDescription>{t("materialDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="material-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Controller
            name="groupId"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="material-group">{t("fields.group")}</FieldLabel>
                <NativeSelect {...field} id="material-group" className="w-full">
                  {groups.map((group) => (
                    <NativeSelectOption key={group.id} value={group.id}>
                      {group.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          />
          <Controller
            name="designation"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="material-designation">{t("fields.designation")}</FieldLabel>
                <Input
                  {...field}
                  id="material-designation"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? (
                  <FieldError>
                    {fieldState.error?.message || t("fieldErrors.designation")}
                  </FieldError>
                ) : (
                  <FieldDescription>{t("designationHint")}</FieldDescription>
                )}
              </Field>
            )}
          />
          <Controller
            name="density"
            control={form.control}
            render={({ field, fieldState }) => (
              <DensityInput
                {...field}
                invalid={fieldState.invalid}
                hint={t("materialDensityHint")}
              />
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="material-form" disabled={pending}>
          {pending ? t("submitting") : t("save")}
        </Button>
      </SheetFooter>
    </>
  );
}

/** Density input shared by both forms (rendered inside each form's Controller). */
function DensityInput({
  invalid,
  hint,
  ...input
}: ComponentProps<"input"> & { invalid: boolean; hint: string }) {
  const t = useTranslations("materials");
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor="material-density">
        {t("fields.density")} <span className="text-muted-foreground">(kg/dm³)</span>
      </FieldLabel>
      <Input
        {...input}
        id="material-density"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
      />
      {invalid ? (
        <FieldError>{t("fieldErrors.density")}</FieldError>
      ) : (
        <FieldDescription>{hint}</FieldDescription>
      )}
    </Field>
  );
}
