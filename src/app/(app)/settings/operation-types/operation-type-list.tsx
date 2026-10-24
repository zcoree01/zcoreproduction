"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArchiveIcon,
  FactoryIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  WorkflowIcon,
} from "lucide-react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  saveOperationTypeAction,
  setOperationTypeArchivedAction,
} from "@/modules/products/actions";
import type { OperationType } from "@/modules/products/queries";
import {
  operationTypeSchema,
  type OperationTypeActionResult,
  type OperationTypeFormValues,
} from "@/modules/products/schemas";

type FormError = Extract<OperationTypeActionResult, { ok: false }>["error"];

export function OperationTypeList({ items }: { items: OperationType[] }) {
  const t = useTranslations("operationTypes");
  const [editing, setEditing] = useState<OperationType | "new" | null>(null);
  const [archiving, setArchiving] = useState<OperationType | null>(null);
  const [, startTransition] = useTransition();

  const restore = (item: OperationType) =>
    startTransition(async () => {
      const result = await setOperationTypeArchivedAction(item.id, false);
      if (result.ok) toast.success(t("restoredToast", { name: item.name }));
      else toast.error(t(`errors.${result.error}`));
    });

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          {t("add")}
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<WorkflowIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t("columns.code")}</TableHead>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {item.code}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>
                    {item.isExternal ? (
                      <span className="flex items-center gap-1">
                        <FactoryIcon className="size-4 text-muted-foreground" aria-hidden />
                        {t("external")}
                      </span>
                    ) : (
                      t("internal")
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={item.archived ? "neutral" : "success"}>
                      {item.archived ? t("status.archived") : t("status.active")}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {item.archived ? (
                        <Button variant="ghost" size="sm" onClick={() => restore(item)}>
                          <RotateCcwIcon />
                          {t("restore")}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("edit", { name: item.name })}
                            onClick={() => setEditing(item)}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("archive", { name: item.name })}
                            onClick={() => setArchiving(item)}
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
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {editing !== null ? (
            <OperationTypeForm
              key={editing === "new" ? "new" : editing.id}
              item={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archiveTitle", { name: archiving?.name ?? "" })}
        description={t("archiveDescription")}
        confirmLabel={t("archiveConfirm")}
        destructive
        onConfirm={async () => {
          if (!archiving) return;
          const result = await setOperationTypeArchivedAction(archiving.id, true);
          if (result.ok) toast.success(t("archivedToast", { name: archiving.name }));
          else toast.error(t(`errors.${result.error}`));
        }}
      />
    </>
  );
}

function OperationTypeForm({ item, onDone }: { item: OperationType | null; onDone: () => void }) {
  const t = useTranslations("operationTypes");
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<OperationTypeFormValues>({
    resolver: zodResolver(operationTypeSchema),
    defaultValues: item
      ? { name: item.name, code: item.code, isExternal: item.isExternal }
      : { name: "", code: "", isExternal: false },
  });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await saveOperationTypeAction(item?.id ?? null, values);
      if (result.ok) {
        toast.success(t(item ? "updatedToast" : "createdToast", { name: values.name.trim() }));
        onDone();
        return;
      }
      if (result.error === "name_taken" || result.error === "code_taken") {
        form.setError(result.error === "name_taken" ? "name" : "code", {
          type: "server",
          message: t(`errors.${result.error}`),
        });
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
        <SheetTitle>{item ? t("editTitle", { name: item.name }) : t("createTitle")}</SheetTitle>
        <SheetDescription>{t("formDescription")}</SheetDescription>
      </SheetHeader>
      <form
        id="operation-type-form"
        onSubmit={onSubmit}
        noValidate
        className="flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          {(["name", "code"] as const).map((name) => (
            <Controller
              key={name}
              name={name}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor={`operation-type-${name}`}>{t(`fields.${name}`)}</FieldLabel>
                  <Input
                    {...field}
                    id={`operation-type-${name}`}
                    autoComplete="off"
                    className={name === "code" ? "font-mono uppercase" : undefined}
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? (
                    <FieldError>
                      {fieldState.error?.type === "server" && fieldState.error.message
                        ? fieldState.error.message
                        : t(`fieldErrors.${name}`)}
                    </FieldError>
                  ) : name === "code" ? (
                    <FieldDescription>{t("codeHint")}</FieldDescription>
                  ) : null}
                </Field>
              )}
            />
          ))}
          <Controller
            name="isExternal"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox
                  id="operation-type-isExternal"
                  checked={field.value}
                  onCheckedChange={(value) => field.onChange(value === true)}
                />
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="operation-type-isExternal">
                    {t("fields.isExternal")}
                  </FieldLabel>
                  <FieldDescription>{t("isExternalHint")}</FieldDescription>
                </div>
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="operation-type-form" disabled={pending}>
          {pending ? t("submitting") : item ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
