"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArchiveIcon, ListIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createCatalogItemAction,
  renameCatalogItemAction,
  setCatalogItemArchivedAction,
} from "@/modules/catalogs/actions";
import type { CatalogItem } from "@/modules/catalogs/queries";
import {
  catalogItemNameSchema,
  type CatalogActionResult,
  type CatalogItemFormValues,
  type CatalogKind,
} from "@/modules/catalogs/schemas";

type FailedResult = Extract<CatalogActionResult, { ok: false }>;

export function CatalogList({ kind, items }: { kind: CatalogKind; items: CatalogItem[] }) {
  const t = useTranslations("catalogs");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<CatalogItem | null>(null);
  const [, startTransition] = useTransition();
  const errorText = (result: FailedResult) => t(`errors.${result.error}`);

  const restore = (item: CatalogItem) =>
    startTransition(async () => {
      const result = await setCatalogItemArchivedAction(item.id, false);
      if (result.ok) toast.success(t("restoredToast", { name: item.name }));
      else toast.error(errorText(result));
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Keyed by kind: switching lists clears a half-typed name. */}
      <AddItemForm key={kind} kind={kind} />
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="h-10 px-4">{t("columns.name")}</TableHead>
              <TableHead className="h-10 w-32 px-4">{t("columns.status")}</TableHead>
              <TableHead className="h-10 w-56 px-4">
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="p-4">
                  <EmptyState
                    icon={<ListIcon />}
                    title={t("emptyTitle")}
                    description={t("emptyDescription")}
                    className="border-0"
                  />
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="h-12 px-4">
                    {renaming === item.id ? (
                      <RenameForm item={item} onDone={() => setRenaming(null)} />
                    ) : (
                      item.name
                    )}
                  </TableCell>
                  <TableCell className="px-4">
                    {item.archived ? (
                      <StatusBadge tone="neutral">{t("status.archived")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">{t("status.active")}</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex justify-end gap-2">
                      {item.archived ? (
                        <Button variant="outline" size="sm" onClick={() => restore(item)}>
                          <RotateCcwIcon />
                          {t("restore")}
                        </Button>
                      ) : renaming === item.id ? null : (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setRenaming(item.id)}>
                            <PencilIcon />
                            {t("rename")}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setArchiving(item)}>
                            <ArchiveIcon />
                            {t("archive")}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archiveTitle", { name: archiving?.name ?? "" })}
        description={t("archiveDescription")}
        confirmLabel={t("archive")}
        destructive
        onConfirm={async () => {
          if (!archiving) return;
          const result = await setCatalogItemArchivedAction(archiving.id, true);
          if (result.ok) toast.success(t("archivedToast", { name: archiving.name }));
          else toast.error(errorText(result));
        }}
      />
    </div>
  );
}

function AddItemForm({ kind }: { kind: CatalogKind }) {
  const t = useTranslations("catalogs");
  const [pending, startTransition] = useTransition();
  const form = useForm<CatalogItemFormValues>({
    resolver: zodResolver(catalogItemNameSchema),
    defaultValues: { name: "" },
  });
  const error = form.formState.errors.name;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createCatalogItemAction(kind, values);
      if (result.ok) {
        toast.success(t("addedToast", { name: values.name }));
        form.reset({ name: "" });
      } else if (result.error === "name_taken" || result.error === "invalid") {
        form.setError("name", { type: "server", message: t(`errors.${result.error}`) });
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-start gap-2">
      <Field data-invalid={error ? true : undefined} className="w-full sm:w-80">
        <FieldLabel htmlFor="catalog-new" className="sr-only">
          {t("newLabel")}
        </FieldLabel>
        <Input
          {...form.register("name")}
          id="catalog-new"
          placeholder={t("newLabel")}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
        {error ? <FieldError>{error.message ?? t("errors.invalid")}</FieldError> : null}
      </Field>
      <Button type="submit" disabled={pending}>
        {t("add")}
      </Button>
    </form>
  );
}

function RenameForm({ item, onDone }: { item: CatalogItem; onDone: () => void }) {
  const t = useTranslations("catalogs");
  const tCommon = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const form = useForm<CatalogItemFormValues>({
    resolver: zodResolver(catalogItemNameSchema),
    defaultValues: { name: item.name },
  });
  const error = form.formState.errors.name;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await renameCatalogItemAction(item.id, values);
      if (result.ok) {
        toast.success(t("renamedToast", { name: values.name }));
        onDone();
      } else if (result.error === "name_taken" || result.error === "invalid") {
        form.setError("name", { type: "server", message: t(`errors.${result.error}`) });
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-start gap-2">
      <Field data-invalid={error ? true : undefined} className="w-full sm:w-64">
        <Input
          {...form.register("name")}
          aria-label={t("renameLabel", { name: item.name })}
          autoComplete="off"
          autoFocus
          aria-invalid={error ? true : undefined}
        />
        {error ? <FieldError>{error.message ?? t("errors.invalid")}</FieldError> : null}
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {tCommon("save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        {tCommon("cancel")}
      </Button>
    </form>
  );
}
