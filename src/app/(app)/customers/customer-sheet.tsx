"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BuildingIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { CompanySearchInput } from "@/components/shared/company-search-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { COUNTRY_CODES, countryName } from "@/lib/countries";
import { getCompanyAction } from "@/modules/companies/actions";
import { saveCustomerAction } from "@/modules/customers/actions";
import type { CustomerRow } from "@/modules/customers/queries";
import {
  customerSchema,
  type CustomerFormValues,
  type CustomerInput,
  type CustomerSaveResult,
} from "@/modules/customers/schemas";

type FormError = Extract<CustomerSaveResult, { ok: false }>["error"];
type TextField = "taxId" | "address" | "postalCode" | "city" | "contactPerson" | "phone" | "email";

/** Public data that come from the shared directory once a customer is linked. */
const DIRECTORY_FIELDS: readonly TextField[] = ["taxId", "address", "postalCode", "city"];

const EMPTY: CustomerFormValues = {
  customerNumber: "",
  name: "",
  taxId: "",
  address: "",
  postalCode: "",
  city: "",
  country: "BA",
  contactPerson: "",
  phone: "",
  email: "",
  notes: "",
  companyId: "",
};

function toFormValues(customer: CustomerRow): CustomerFormValues {
  return {
    customerNumber: String(customer.number),
    name: customer.name,
    taxId: customer.taxId ?? "",
    address: customer.address ?? "",
    postalCode: customer.postalCode ?? "",
    city: customer.city ?? "",
    country: customer.country ?? "",
    contactPerson: customer.contactPerson ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    notes: customer.notes ?? "",
    companyId: customer.companyId ?? "",
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
  const [confirmReuse, setConfirmReuse] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<CustomerFormValues, unknown, CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? toFormValues(customer) : EMPTY,
  });
  const [companyId, country] = useWatch({ control: form.control, name: ["companyId", "country"] });
  const linked = Boolean(companyId);
  // An existing link is kept; a pick while creating a customer can be undone.
  const canUnlink = linked && !customer?.companyId;

  const pickCompany = async (id: string) => {
    const company = await getCompanyAction(id);
    if (!company) {
      toast.error(t("directory.loadFailed"));
      return;
    }
    const options = { shouldDirty: true } as const;
    form.setValue("companyId", company.id, options);
    form.setValue("name", company.name, options);
    form.setValue("taxId", company.taxId, options);
    form.setValue("address", company.address ?? "", options);
    form.setValue("postalCode", company.postalCode ?? "", options);
    form.setValue("city", company.city ?? "", options);
    form.setValue("country", company.country, options);
    if (company.phone) form.setValue("phone", company.phone, options);
    if (company.email) form.setValue("email", company.email, options);
    form.clearErrors();
  };

  const save = (values: CustomerInput, reuse: boolean) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveCustomerAction(customer?.id ?? null, form.getValues(), reuse);
      if (result.ok) {
        toast.success(
          customer
            ? t("updatedToast", { name: values.name })
            : t("createdToast", { name: values.name }),
          {
            description:
              result.directory === "created"
                ? t("directory.createdToast")
                : result.changeRequested
                  ? t("directory.changeRequestedToast")
                  : undefined,
          },
        );
        onDone();
        if (customer) router.refresh();
        else router.push(`/customers/${result.id}`);
        return;
      }
      if (result.error === "name_taken") {
        form.setError("name", { type: "server", message: t("errors.name_taken") });
      } else if (result.error === "number_taken") {
        form.setError("customerNumber", { type: "server", message: t("errors.number_taken") });
      } else if (result.error === "number_of_archived") {
        setConfirmReuse(true);
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const name of result.fields) {
          if (name !== "companyId") form.setError(name, { type: "server" });
        }
      } else {
        setFormError(result.error);
      }
    });
  };
  const onSubmit = form.handleSubmit((values) => save(values, false));

  const errorText = (name: TextField | "name", error?: { type?: string; message?: string }) =>
    error?.type === "server" && error.message
      ? error.message
      : error?.message === "ba_tax_id"
        ? t("fieldErrors.baTaxId")
        : t(`fieldErrors.${name}`);

  const field = (
    name: TextField,
    options: { type?: string; inputMode?: "email" | "tel"; hint?: string } = {},
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
            readOnly={linked && DIRECTORY_FIELDS.includes(name)}
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>{errorText(name, fieldState.error)}</FieldError>
          ) : options.hint ? (
            <FieldDescription>{options.hint}</FieldDescription>
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
          <Controller
            name="customerNumber"
            control={form.control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="customer-customerNumber">{t("customerNumber")}</FieldLabel>
                <Input
                  {...input}
                  id="customer-customerNumber"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t("customerNumberPlaceholder")}
                  className="max-w-40 tabular-nums"
                  aria-invalid={fieldState.invalid || undefined}
                />
                {fieldState.invalid ? (
                  <FieldError>
                    {fieldState.error?.type === "server" && fieldState.error.message
                      ? fieldState.error.message
                      : t("fieldErrors.customerNumber")}
                  </FieldError>
                ) : (
                  <FieldDescription>{t("customerNumberHint")}</FieldDescription>
                )}
              </Field>
            )}
          />
          <Controller
            name="name"
            control={form.control}
            render={({ field: input, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="customer-name">{t("name")}</FieldLabel>
                {linked ? (
                  <Input {...input} id="customer-name" readOnly />
                ) : (
                  <CompanySearchInput
                    id="customer-name"
                    name={input.name}
                    value={input.value}
                    onChange={input.onChange}
                    onPick={(suggestion) => void pickCompany(suggestion.id)}
                    aria-invalid={fieldState.invalid || undefined}
                  />
                )}
                {fieldState.invalid ? (
                  <FieldError>{errorText("name", fieldState.error)}</FieldError>
                ) : linked ? null : (
                  <FieldDescription>{t("directory.searchHint")}</FieldDescription>
                )}
              </Field>
            )}
          />
          {linked ? (
            <Alert>
              <BuildingIcon />
              <AlertTitle>{t("directory.linkedTitle")}</AlertTitle>
              <AlertDescription>
                <p>{t("directory.linkedDescription")}</p>
                {canUnlink ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => form.setValue("companyId", "")}
                  >
                    {t("directory.unlink")}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              name="country"
              control={form.control}
              render={({ field: input }) => (
                <Field>
                  <FieldLabel htmlFor="customer-country">{t("country")}</FieldLabel>
                  <NativeSelect
                    {...input}
                    id="customer-country"
                    className="w-full"
                    disabled={linked}
                  >
                    <NativeSelectOption value="">{t("countryNone")}</NativeSelectOption>
                    {input.value && !(COUNTRY_CODES as readonly string[]).includes(input.value) ? (
                      <NativeSelectOption value={input.value}>{input.value}</NativeSelectOption>
                    ) : null}
                    {COUNTRY_CODES.map((code) => (
                      <NativeSelectOption key={code} value={code}>
                        {countryName(code)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            />
            {field("taxId", {
              hint: linked
                ? undefined
                : country === "BA"
                  ? t("directory.taxIdHintBa")
                  : t("directory.taxIdHint"),
            })}
          </div>
          {field("address")}
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            {field("postalCode")}
            {field("city")}
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
      <ConfirmDialog
        open={confirmReuse}
        onOpenChange={setConfirmReuse}
        title={t("reuseTitle", { number: form.getValues("customerNumber") })}
        description={t("reuseDescription")}
        confirmLabel={t("reuseConfirm")}
        onConfirm={() => {
          const parsed = customerSchema.safeParse(form.getValues());
          if (parsed.success) save(parsed.data, true);
        }}
      />
    </>
  );
}
