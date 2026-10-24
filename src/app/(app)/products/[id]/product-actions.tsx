"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArchiveIcon,
  CopyIcon,
  EllipsisIcon,
  GitBranchPlusIcon,
  HistoryIcon,
  PencilIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  copyProductAction,
  createRevisionAction,
  setCurrentRevisionAction,
  setProductArchivedAction,
} from "@/modules/products/actions";
import type { ProductDetail, ProductRevision, RevisionSummary } from "@/modules/products/queries";
import {
  copyProductSchema,
  newRevisionSchema,
  type CopyProductFormValues,
  type NewRevisionFormValues,
  type ProductActionResult,
} from "@/modules/products/schemas";
import { ProductSheet, type ProductCatalogs } from "../product-sheet";

type FormError = Extract<ProductActionResult, { ok: false }>["error"];

/** Switches the viewed revision (?rev=); the current one is the default. */
export function RevisionPicker({
  productId,
  revisions,
  selectedId,
}: {
  productId: string;
  revisions: RevisionSummary[];
  selectedId: string;
}) {
  const t = useTranslations("products.detail");
  const router = useRouter();
  if (revisions.length < 2) return null;
  return (
    <NativeSelect
      aria-label={t("revisionPicker")}
      value={selectedId}
      onChange={(event) => {
        const target = revisions.find((r) => r.id === event.target.value);
        if (!target) return;
        router.push(
          target.isCurrent ? `/products/${productId}` : `/products/${productId}?rev=${target.id}`,
        );
      }}
    >
      {revisions.map((revision) => (
        <NativeSelectOption key={revision.id} value={revision.id}>
          {revision.isCurrent
            ? t("revisionOptionCurrent", { revision: revision.revision })
            : t("revisionOption", { revision: revision.revision })}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function SetCurrentRevisionButton({
  revisionId,
  revision,
}: {
  revisionId: string;
  revision: string;
}) {
  const t = useTranslations("products");
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          <HistoryIcon />
          {t("detail.setCurrent", { revision })}
        </Button>
      }
      title={t("detail.setCurrentTitle", { revision })}
      description={t("detail.setCurrentDescription")}
      confirmLabel={t("detail.setCurrentConfirm")}
      onConfirm={async () => {
        const result = await setCurrentRevisionAction(revisionId);
        if (result.ok) {
          toast.success(t("detail.setCurrentToast", { revision }));
          router.refresh();
        } else {
          toast.error(t(`errors.${result.error}`));
        }
      }}
    />
  );
}

export function ProductActions({
  product,
  revision,
  editable,
  suggestedRevision,
  catalogs,
}: {
  product: ProductDetail;
  revision: ProductRevision;
  editable: boolean;
  suggestedRevision: string;
  catalogs: ProductCatalogs;
}) {
  const t = useTranslations("products");
  const router = useRouter();
  const [sheet, setSheet] = useState<"edit" | "revision" | "copy" | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [, startTransition] = useTransition();

  const restore = () =>
    startTransition(async () => {
      const result = await setProductArchivedAction(product.id, false);
      if (result.ok) {
        toast.success(t("restoredToast", { code: product.partNumber }));
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <>
      {editable ? (
        <Button variant="outline" onClick={() => setSheet("edit")}>
          <PencilIcon />
          {t("detail.edit")}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" aria-label={t("detail.moreActions")} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {product.archived ? (
            <DropdownMenuItem onClick={restore}>
              <RotateCcwIcon />
              {t("rowActions.restore")}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setSheet("revision")}>
                <GitBranchPlusIcon />
                {t("detail.newRevision")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSheet("copy")}>
                <CopyIcon />
                {t("detail.copy")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setArchiving(true)}>
                <ArchiveIcon />
                {t("rowActions.archive")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {editable ? (
        <ProductSheet
          open={sheet === "edit"}
          onOpenChange={(open) => !open && setSheet(null)}
          editing={{ product, revision }}
          catalogs={catalogs}
        />
      ) : null}
      <Sheet open={sheet === "revision"} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {sheet === "revision" ? (
            <NewRevisionForm
              product={product}
              source={revision}
              suggested={suggestedRevision}
              onDone={() => setSheet(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <Sheet open={sheet === "copy"} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {sheet === "copy" ? (
            <CopyProductForm product={product} source={revision} onDone={() => setSheet(null)} />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("archiveTitle", { code: product.partNumber })}
        description={t("archiveDescription")}
        confirmLabel={t("rowActions.archive")}
        destructive
        onConfirm={async () => {
          const result = await setProductArchivedAction(product.id, true);
          if (result.ok) {
            toast.success(t("archivedToast", { code: product.partNumber }));
            router.refresh();
          } else {
            toast.error(t(`errors.${result.error}`));
          }
        }}
      />
    </>
  );
}

function NewRevisionForm({
  product,
  source,
  suggested,
  onDone,
}: {
  product: ProductDetail;
  source: ProductRevision;
  suggested: string;
  onDone: () => void;
}) {
  const t = useTranslations("products");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<NewRevisionFormValues>({
    resolver: zodResolver(newRevisionSchema),
    defaultValues: { revision: suggested },
  });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await createRevisionAction(product.id, values, source.id);
      if (result.ok) {
        toast.success(t("revisionForm.createdToast", { revision: values.revision.toUpperCase() }));
        onDone();
        router.push(`/products/${product.id}`);
        router.refresh();
        return;
      }
      if (result.error === "revision_taken" || result.error === "invalid") {
        form.setError("revision", {
          type: "server",
          message: t(`revisionForm.errors.${result.error}`),
        });
      } else {
        setFormError(result.error);
      }
    });
  });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("revisionForm.title", { code: product.partNumber })}</SheetTitle>
        <SheetDescription>
          {t("revisionForm.description", { source: source.revision })}
        </SheetDescription>
      </SheetHeader>
      <form
        id="revision-form"
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
          <Controller
            name="revision"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="revision-label">{t("revisionForm.revision")}</FieldLabel>
                <Input
                  {...field}
                  id="revision-label"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? (
                  <FieldError>
                    {fieldState.error?.type === "server" && fieldState.error.message
                      ? fieldState.error.message
                      : t("revisionForm.errors.invalid")}
                  </FieldError>
                ) : (
                  <FieldDescription>{t("revisionForm.hint")}</FieldDescription>
                )}
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="revision-form" disabled={pending}>
          {pending ? t("form.submitting") : t("revisionForm.submit")}
        </Button>
      </SheetFooter>
    </>
  );
}

function CopyProductForm({
  product,
  source,
  onDone,
}: {
  product: ProductDetail;
  source: ProductRevision;
  onDone: () => void;
}) {
  const t = useTranslations("products");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CopyProductFormValues>({
    resolver: zodResolver(copyProductSchema),
    defaultValues: { partNumber: "", name: product.name, revision: "A" },
  });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      const result = await copyProductAction(source.id, values);
      if (result.ok) {
        toast.success(t("copyForm.createdToast", { code: values.partNumber.trim() }));
        onDone();
        router.push(`/products/${result.id}`);
        return;
      }
      if (result.error === "part_number_taken") {
        form.setError("partNumber", {
          type: "server",
          message: t("form.errors.part_number_taken"),
        });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) {
          if (field === "partNumber" || field === "name" || field === "revision") {
            form.setError(field, { type: "server" });
          }
        }
      } else {
        setFormError(result.error);
      }
    });
  });

  const field = (name: "partNumber" | "name" | "revision") => (
    <Controller
      name={name}
      control={form.control}
      render={({ field: input, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`copy-${name}`}>{t(`form.${name}`)}</FieldLabel>
          <Input
            {...input}
            id={`copy-${name}`}
            autoComplete="off"
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>
              {fieldState.error?.type === "server" && fieldState.error.message
                ? fieldState.error.message
                : t(`form.fieldErrors.${name}`)}
            </FieldError>
          ) : null}
        </Field>
      )}
    />
  );

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("copyForm.title", { code: product.partNumber })}</SheetTitle>
        <SheetDescription>
          {t("copyForm.description", { source: source.revision })}
        </SheetDescription>
      </SheetHeader>
      <form id="copy-form" onSubmit={onSubmit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
            </Alert>
          ) : null}
          {field("partNumber")}
          {field("name")}
          {field("revision")}
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="copy-form" disabled={pending}>
          {pending ? t("form.submitting") : t("copyForm.submit")}
        </Button>
      </SheetFooter>
    </>
  );
}
