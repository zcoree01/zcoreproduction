"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { saveCustomerAction } from "@/modules/customers/actions";
import type { CustomerRow } from "@/modules/customers/queries";
import {
  customerSchema,
  type CustomerActionResult,
  type CustomerFormValues,
  type CustomerInput,
} from "@/modules/customers/schemas";

type FormError = Extract<CustomerActionResult, { ok: false }>["error"];

const EMPTY: CustomerFormValues = {
  name: "",
  taxId: "",
  address: "",
  city: "",
  country: "",
  contactPerson: "",
  phone: "",
  email: "",
  notes: "",
};

function toFormValues(customer: CustomerRow): CustomerFormValues {
  return {
    name: customer.name,
    taxId: customer.taxId ?? "",
    address: customer.address ?? "",
    city: customer.city ?? "",
    country: customer.country ?? "",
    contactPerson: customer.contactPerson ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    notes: customer.notes ?? "",
  };
}

export function CreateCustomerButton() {
  const t = useTranslations("customers.form");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("open")}
      </Button>
      <CustomerSheet open={open} onOpenChange={setOpen} customer={null} />
    </>
  );
}

export function CustomerSheet({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerRow | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        {open ? (
          <CustomerForm
            key={customer?.id ?? "new"}
            customer={customer}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CustomerForm({ customer, onDone }: { customer: CustomerRow | null; onDone: () => void }) {
  const t = useTranslations("customers.form");
  const router = useRouter();
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CustomerFormValues, unknown, CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? toFormValues(customer) : EMPTY,
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveCustomerAction(customer?.id ?? null, form.getValues());
      if (result.ok) {
        toast.success(
          customer
            ? t("updatedToast", { name: values.name })
            : t("createdToast", { name: values.name }),
        );
        onDone();
        if (customer) router.refresh();
        else router.push(`/customers/${result.id}`);
        return;
      }
      if (result.error === "name_taken") {
        form.setError("name", { type: "server", message: t("errors.name_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const field = (
    name: Exclude<keyof CustomerFormValues, "notes">,
    options: { type?: string; inputMode?: "email" | "tel" } = {},
  ) => (
    <Controller
      key={name}
      name={name}
      control={form.control}
      render={({ field: input, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`customer-${name}`}>{t(name)}</FieldLabel>
          <Input
            {...input}
            id={`customer-${name}`}
            type={options.type}
            inputMode={options.inputMode}
            autoComplete="off"
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>
              {fieldState.error?.type === "server" && fieldState.error.message
                ? fieldState.error.message
                : t(`fieldErrors.${name}`)}
            </FieldError>
          ) : null}
        </Field>
      )}
    />
  );

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {customer ? t("editTitle", { name: customer.name }) : t("createTitle")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <form
        id="customer-form"
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
          {field("name")}
          {field("taxId")}
          {field("address")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("city")}
            {field("country")}
          </div>
          {field("contactPerson")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("phone", { type: "tel", inputMode: "tel" })}
            {field("email", { type: "email", inputMode: "email" })}
          </div>
          <Controller
            name="notes"
            control={form.control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="customer-notes">{t("notes")}</FieldLabel>
                <Textarea
                  {...input}
                  id="customer-notes"
                  rows={3}
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? <FieldError>{t("fieldErrors.notes")}</FieldError> : null}
              </Field>
            )}
          />
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="customer-form" disabled={pending}>
          {pending ? t("submitting") : customer ? t("submitEdit") : t("submitCreate")}
        </Button>
      </SheetFooter>
    </>
  );
}
