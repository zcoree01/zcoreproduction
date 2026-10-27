"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Controller,
  useFieldArray,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COUNTRY_CODES, countryName } from "@/lib/countries";
import {
  baAccountToIban,
  EMPTY_BANK_ACCOUNT,
  isValidBaAccount,
  type CompanyProfileFormValues,
} from "@/modules/companies/schemas";

type Form = UseFormReturn<CompanyProfileFormValues, unknown, unknown>;
type TextPath = Exclude<
  FieldPath<CompanyProfileFormValues>,
  "country" | "bankAccounts" | `bankAccounts.${number}` | `bankAccounts.${number}.isPrimary`
>;

/** Fields of each part (also the steps of the registration). */
export const COMPANY_SECTION_FIELDS = {
  basics: ["name", "shortName", "legalForm", "country", "taxId", "vatId", "activity"],
  contact: [
    "address",
    "postalCode",
    "city",
    "mailAddress",
    "mailPostalCode",
    "mailCity",
    "phone",
    "email",
    "website",
  ],
  banking: ["bankAccounts"],
} as const satisfies Record<string, readonly FieldPath<CompanyProfileFormValues>[]>;

export type CompanySection = keyof typeof COMPANY_SECTION_FIELDS;

const LEGAL_FORMS = ["d.o.o.", "d.d.", "j.d.o.o.", "o.d.", "k.d.", "s.p.", "obrt", "zadruga"];

function useFieldText() {
  const t = useTranslations("companyFields");
  const tError = useTranslations("companyFields.errors");
  return {
    label: (name: string) => t(name as Parameters<typeof t>[0]),
    error: (message: string | undefined, name: string) => {
      const known = ["ba_tax_id", "ba_vat_id", "ba_account", "iban", "swift", "email", "required"];
      return message && known.includes(message)
        ? tError(message as Parameters<typeof tError>[0])
        : tError(`field.${name}` as Parameters<typeof tError>[0]);
    },
  };
}

function TextInput({
  form,
  name,
  label,
  hint,
  readOnly,
  type,
  inputMode,
  autoComplete,
  required,
}: {
  form: Form;
  name: TextPath;
  label: string;
  hint?: string;
  readOnly?: boolean;
  type?: string;
  inputMode?: "email" | "tel" | "numeric" | "url";
  autoComplete?: string;
  required?: boolean;
}) {
  const text = useFieldText();
  const id = `company-${name.replaceAll(".", "-")}`;
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={id}>
            {label}
            {required ? <span aria-hidden> *</span> : null}
          </FieldLabel>
          <Input
            {...field}
            value={typeof field.value === "string" ? field.value : ""}
            id={id}
            type={type}
            inputMode={inputMode}
            autoComplete={autoComplete ?? "off"}
            readOnly={readOnly}
            aria-required={required || undefined}
            aria-invalid={fieldState.invalid || undefined}
          />
          {fieldState.invalid ? (
            <FieldError>
              {text.error(fieldState.error?.message, name.split(".").at(-1) ?? name)}
            </FieldError>
          ) : hint ? (
            <FieldDescription>{hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );
}

/** "Osnovne informacije": name, legal form, country, ID / VAT number, activity. */
export function CompanyBasicsFields({
  form,
  lockTaxId = false,
}: {
  form: Form;
  lockTaxId?: boolean;
}) {
  const t = useTranslations("companyFields");
  const text = useFieldText();
  const country = useWatch({ control: form.control, name: "country" });
  return (
    <FieldGroup>
      <TextInput form={form} name="name" label={text.label("name")} hint={t("nameHint")} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          form={form}
          name="shortName"
          label={text.label("shortName")}
          hint={t("shortNameHint")}
        />
        <Controller
          name="legalForm"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="company-legalForm">{text.label("legalForm")}</FieldLabel>
              <Input
                {...field}
                id="company-legalForm"
                list="company-legal-forms"
                autoComplete="off"
              />
              <datalist id="company-legal-forms">
                {LEGAL_FORMS.map((form) => (
                  <option key={form} value={form} />
                ))}
              </datalist>
            </Field>
          )}
        />
      </div>
      <Controller
        name="country"
        control={form.control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="company-country">
              {text.label("country")}
              <span aria-hidden> *</span>
            </FieldLabel>
            <NativeSelect {...field} id="company-country" className="w-full" disabled={lockTaxId}>
              {COUNTRY_CODES.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {countryName(code)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          form={form}
          name="taxId"
          label={country === "BA" ? t("taxIdBa") : text.label("taxId")}
          hint={lockTaxId ? t("taxIdLocked") : country === "BA" ? t("taxIdBaHint") : t("taxIdHint")}
          inputMode={country === "BA" ? "numeric" : undefined}
          readOnly={lockTaxId}
          required
        />
        <TextInput
          form={form}
          name="vatId"
          label={country === "BA" ? t("vatIdBa") : text.label("vatId")}
          hint={country === "BA" ? t("vatIdBaHint") : undefined}
          inputMode={country === "BA" ? "numeric" : undefined}
        />
      </div>
      <TextInput
        form={form}
        name="activity"
        label={text.label("activity")}
        hint={t("activityHint")}
      />
    </FieldGroup>
  );
}

/** "Adresa i kontakt": seat, mailing address if different, phone, e-mail, web. */
export function CompanyContactFields({ form }: { form: Form }) {
  const t = useTranslations("companyFields");
  const text = useFieldText();
  return (
    <FieldGroup>
      <TextInput
        form={form}
        name="address"
        label={text.label("address")}
        autoComplete="street-address"
        required
      />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <TextInput
          form={form}
          name="postalCode"
          label={text.label("postalCode")}
          autoComplete="postal-code"
        />
        <TextInput
          form={form}
          name="city"
          label={text.label("city")}
          autoComplete="address-level2"
          required
        />
      </div>
      <fieldset className="flex flex-col gap-4 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{t("mailLegend")}</legend>
        <p className="text-sm text-muted-foreground">{t("mailHint")}</p>
        <TextInput form={form} name="mailAddress" label={text.label("mailAddress")} />
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <TextInput form={form} name="mailPostalCode" label={text.label("mailPostalCode")} />
          <TextInput form={form} name="mailCity" label={text.label("mailCity")} />
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          form={form}
          name="phone"
          label={text.label("phone")}
          type="tel"
          inputMode="tel"
        />
        <TextInput
          form={form}
          name="email"
          label={text.label("email")}
          type="email"
          inputMode="email"
        />
      </div>
      <TextInput form={form} name="website" label={text.label("website")} inputMode="url" />
    </FieldGroup>
  );
}

/** "Plaćanje": bank accounts (Bosnian account number → IBAN filled in). */
export function CompanyBankingFields({ form }: { form: Form }) {
  const t = useTranslations("companyFields");
  const text = useFieldText();
  const accounts = useFieldArray({ control: form.control, name: "bankAccounts" });
  const [country, values] = useWatch({ control: form.control, name: ["country", "bankAccounts"] });

  return (
    <FieldGroup>
      <p className="text-sm text-muted-foreground">{t("bankingHint")}</p>
      {accounts.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("noBankAccounts")}
        </p>
      ) : null}
      {accounts.fields.map((account, index) => (
        <fieldset key={account.id} className="flex flex-col gap-4 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">
            {t("bankAccountLegend", { number: index + 1 })}
          </legend>
          <TextInput
            form={form}
            name={`bankAccounts.${index}.bankName`}
            label={text.label("bankName")}
            required
          />
          <TextInput
            form={form}
            name={`bankAccounts.${index}.accountNumber`}
            label={country === "BA" ? t("accountNumberBa") : text.label("accountNumber")}
            hint={country === "BA" ? t("accountNumberBaHint") : undefined}
            inputMode={country === "BA" ? "numeric" : undefined}
          />
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <TextInput form={form} name={`bankAccounts.${index}.iban`} label={text.label("iban")} />
            <TextInput
              form={form}
              name={`bankAccounts.${index}.swift`}
              label={text.label("swift")}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id={`company-bank-primary-${index}`}
                checked={values?.[index]?.isPrimary ?? false}
                onCheckedChange={(checked) =>
                  (values ?? []).forEach((_, other) =>
                    form.setValue(`bankAccounts.${other}.isPrimary`, checked && other === index, {
                      shouldDirty: true,
                    }),
                  )
                }
              />
              <FieldLabel htmlFor={`company-bank-primary-${index}`} className="font-normal">
                {t("primaryAccount")}
              </FieldLabel>
            </Field>
            <div className="flex gap-2">
              {country === "BA" &&
              values?.[index]?.accountNumber &&
              !values[index]?.iban &&
              isValidBaAccount(values[index].accountNumber) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    form.setValue(
                      `bankAccounts.${index}.iban`,
                      baAccountToIban(values[index]?.accountNumber ?? ""),
                      { shouldDirty: true },
                    )
                  }
                >
                  {t("fillIban")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => accounts.remove(index)}
              >
                <Trash2Icon />
                {t("removeBankAccount")}
              </Button>
            </div>
          </div>
        </fieldset>
      ))}
      {accounts.fields.length < 10 ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            accounts.append({ ...EMPTY_BANK_ACCOUNT, isPrimary: accounts.fields.length === 0 })
          }
        >
          <PlusIcon />
          {t("addBankAccount")}
        </Button>
      ) : null}
    </FieldGroup>
  );
}
