"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckBigIcon,
  PencilIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { Controller, useForm, useWatch, type UseFormReturn } from "react-hook-form";
import {
  CompanyBankingFields,
  CompanyBasicsFields,
  CompanyContactFields,
} from "@/components/shared/company/company-sections";
import { PasswordInput } from "@/components/shared/password-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { countryName } from "@/lib/countries";
import { cn } from "@/lib/utils";
import type { CompanyProfileFormValues } from "@/modules/companies/schemas";
import {
  checkSlugAction,
  registerOrganizationAction,
  type RegistrationResult,
  type SlugCheckResult,
} from "@/modules/registration/actions";
import {
  draftOf,
  EMPTY_REGISTRATION,
  REGISTRATION_STEPS,
  registrationSchema,
  suggestSlug,
  TIMEZONES,
  type RegistrationFormValues,
  type RegistrationInput,
  type RegistrationStepKey,
} from "@/modules/registration/schemas";
import { splitFullName, usernameCandidates } from "@/modules/users/username-suggest";

const DRAFT_KEY = "zcore-registration-draft";

function loadDraft(): RegistrationFormValues {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_REGISTRATION;
    return { ...EMPTY_REGISTRATION, ...(JSON.parse(raw) as Partial<RegistrationFormValues>) };
  } catch {
    return EMPTY_REGISTRATION;
  }
}

function saveDraft(values: RegistrationFormValues) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftOf(values)));
  } catch {
    // Private mode or blocked storage: the wizard works without a draft.
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // See saveDraft.
  }
}

type Success = Extract<RegistrationResult, { ok: true }>;

const noSubscribe = () => () => {};

/** False during server rendering and hydration: buttons wait for React. */
function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** Company registration in six named steps; values survive going back and forth. */
export function RegistrationWizard() {
  const t = useTranslations("registration");
  const [step, setStep] = useState(0);
  const [success, setSuccess] = useState<Success | null>(null);
  const [submitError, setSubmitError] = useState<
    Extract<RegistrationResult, { ok: false }>["error"] | null
  >(null);
  const [slugState, setSlugState] = useState<SlugCheckResult | "checking" | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<RegistrationFormValues, unknown, RegistrationInput>({
    resolver: zodResolver(registrationSchema),
    defaultValues: EMPTY_REGISTRATION,
    mode: "onTouched",
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const hydrated = useHydrated();

  // Restore a draft of this browser tab (never the password).
  useEffect(() => {
    form.reset(loadDraft());
  }, [form]);

  const current = REGISTRATION_STEPS[step] ?? REGISTRATION_STEPS[0];
  const companyForm = form as unknown as UseFormReturn<CompanyProfileFormValues, unknown, unknown>;

  const goTo = (index: number) => {
    setStep(index);
    saveDraft(form.getValues());
    requestAnimationFrame(() => heading.current?.focus());
  };

  const next = async () => {
    const valid = await form.trigger([...current.fields]);
    if (!valid) return;
    if (current.key === "system") {
      const result = await checkSlugAction(form.getValues("slug"));
      setSlugState(result);
      if (result !== "available") {
        form.setError("slug", { type: "server", message: `slug_${result}` });
        return;
      }
    }
    goTo(step + 1);
  };

  const submit = () =>
    startTransition(async () => {
      setSubmitError(null);
      const valid = await form.trigger();
      if (!valid) {
        const firstInvalid = REGISTRATION_STEPS.findIndex((s) =>
          s.fields.some((field) => form.getFieldState(field).invalid),
        );
        if (firstInvalid >= 0) goTo(firstInvalid);
        return;
      }
      const result = await registerOrganizationAction(form.getValues());
      if (result.ok) {
        clearDraft();
        setSuccess(result);
        return;
      }
      setSubmitError(result.error);
      if (result.error === "slug_taken") {
        form.setError("slug", { type: "server", message: "slug_taken" });
        goTo(REGISTRATION_STEPS.findIndex((s) => s.key === "system"));
      } else if (result.error === "company_owned") {
        form.setError("taxId", { type: "server", message: "company_owned" });
        goTo(0);
      } else if (result.error === "weak_password") {
        form.setError("adminPassword", { type: "server", message: "weak_password" });
        goTo(REGISTRATION_STEPS.findIndex((s) => s.key === "admin"));
      }
    });

  if (success) return <SuccessCard success={success} />;

  return (
    <Card>
      <CardHeader className="gap-4">
        <Stepper current={step} onSelect={(index) => index < step && goTo(index)} />
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {t("stepOf", { step: step + 1, total: REGISTRATION_STEPS.length })}
          </p>
          <CardTitle className="text-xl">
            <h2 ref={heading} tabIndex={-1} className="outline-none">
              {t(`steps.${current.key}.title`)}
            </h2>
          </CardTitle>
          <CardDescription>{t(`steps.${current.key}.description`)}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (current.key === "review") submit();
            else void next();
          }}
          id="registration-form"
        >
          {/* Honeypot: hidden from people and assistive technology. */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="hidden"
            {...form.register("website2")}
          />
          {current.key === "basics" ? <CompanyBasicsFields form={companyForm} /> : null}
          {current.key === "contact" ? <CompanyContactFields form={companyForm} /> : null}
          {current.key === "banking" ? <CompanyBankingFields form={companyForm} /> : null}
          {current.key === "system" ? (
            <SystemStep form={form} slugState={slugState} onSlugChange={() => setSlugState(null)} />
          ) : null}
          {current.key === "admin" ? <AdminStep form={form} /> : null}
          {current.key === "review" ? (
            <ReviewStep form={form} onEdit={goTo} error={submitError} />
          ) : null}
        </form>
      </CardContent>
      <CardFooter className="flex justify-between gap-2 border-t">
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={step === 0 || pending}
          onClick={() => goTo(step - 1)}
        >
          <ChevronLeftIcon />
          {t("back")}
        </Button>
        <Button
          type="submit"
          form="registration-form"
          className="h-11"
          disabled={pending || !hydrated}
        >
          {current.key === "review" ? (
            pending ? (
              t("submitting")
            ) : (
              <>
                <CheckIcon />
                {t("submit")}
              </>
            )
          ) : (
            <>
              {t("next")}
              <ChevronRightIcon />
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stepper({ current, onSelect }: { current: number; onSelect: (index: number) => void }) {
  const t = useTranslations("registration");
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label={t("stepsLabel")}>
      {REGISTRATION_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.key} className="flex flex-col items-center gap-1 text-center">
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={!done}
              aria-current={active ? "step" : undefined}
              aria-label={t(`steps.${step.key}.title`)}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary text-primary hover:bg-primary/10",
                !active && !done && "text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-4" /> : index + 1}
            </button>
            <span
              className={cn(
                "hidden text-xs sm:block",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {t(`steps.${step.key}.short`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SystemStep({
  form,
  slugState,
  onSlugChange,
}: {
  form: UseFormReturn<RegistrationFormValues, unknown, RegistrationInput>;
  slugState: SlugCheckResult | "checking" | null;
  onSlugChange: () => void;
}) {
  const t = useTranslations("registration.system");
  const [name, shortName, slug] = useWatch({
    control: form.control,
    name: ["name", "shortName", "slug"],
  });

  // Suggest a subdomain from the name the first time this step opens.
  useEffect(() => {
    if (!form.getValues("slug")) {
      form.setValue("slug", suggestSlug(shortName || name), { shouldDirty: true });
    }
  }, [form, name, shortName]);

  return (
    <FieldGroup>
      <Controller
        name="slug"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor="registration-slug">{t("slug")}</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                {...field}
                id="registration-slug"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 font-mono"
                onChange={(event) => {
                  field.onChange(event.target.value.toLowerCase());
                  onSlugChange();
                }}
                aria-invalid={fieldState.invalid || undefined}
              />
              <span className="shrink-0 font-mono text-sm text-muted-foreground">.zcore.ba</span>
            </div>
            {fieldState.invalid ? (
              <FieldError>{t(`errors.${slugError(fieldState.error?.message)}`)}</FieldError>
            ) : slugState === "available" ? (
              <FieldDescription className="text-emerald-700 dark:text-emerald-400">
                {t("available", { address: `${slug}.zcore.ba` })}
              </FieldDescription>
            ) : (
              <FieldDescription>{t("slugHint")}</FieldDescription>
            )}
          </Field>
        )}
      />
      <Controller
        name="timezone"
        control={form.control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="registration-timezone">{t("timezone")}</FieldLabel>
            <NativeSelect {...field} id="registration-timezone" className="w-full">
              {TIMEZONES.map((zone) => (
                <NativeSelectOption key={zone} value={zone}>
                  {zone.replace("Europe/", "").replace("_", " ")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t("timezoneHint")}</FieldDescription>
          </Field>
        )}
      />
    </FieldGroup>
  );
}

function slugError(message: string | undefined) {
  switch (message) {
    case "slug_short":
    case "slug_reserved":
    case "slug_taken":
    case "slug_rate_limited":
      return message;
    default:
      return "slug_invalid";
  }
}

function AdminStep({
  form,
}: {
  form: UseFormReturn<RegistrationFormValues, unknown, RegistrationInput>;
}) {
  const t = useTranslations("registration.admin");
  const fullName = useWatch({ control: form.control, name: "adminFullName" });

  const passwordError = (
    message: string | undefined,
    name: "adminPassword" | "adminConfirmPassword",
  ) =>
    message === "username"
      ? t("errors.notUsername")
      : message === "mismatch"
        ? t("errors.mismatch")
        : message === "weak_password"
          ? t("errors.weak")
          : t(`errors.${name}`);

  return (
    <FieldGroup>
      <Controller
        name="adminFullName"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor="registration-admin-name">{t("fullName")}</FieldLabel>
            <Input
              {...field}
              id="registration-admin-name"
              autoComplete="name"
              className="h-11"
              onBlur={() => {
                field.onBlur();
                if (!form.getValues("adminUsername") && fullName.trim()) {
                  const parts = splitFullName(fullName);
                  form.setValue(
                    "adminUsername",
                    usernameCandidates(parts.firstName, parts.lastName)[0] ?? "",
                  );
                }
              }}
              aria-invalid={fieldState.invalid || undefined}
            />
            {fieldState.invalid ? <FieldError>{t("errors.adminFullName")}</FieldError> : null}
          </Field>
        )}
      />
      <Controller
        name="adminUsername"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel htmlFor="registration-admin-username">{t("username")}</FieldLabel>
            <Input
              {...field}
              id="registration-admin-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="h-11 font-mono"
              aria-invalid={fieldState.invalid || undefined}
            />
            {fieldState.invalid ? (
              <FieldError>{t("errors.adminUsername")}</FieldError>
            ) : (
              <FieldDescription>{t("usernameHint")}</FieldDescription>
            )}
          </Field>
        )}
      />
      {(["adminPassword", "adminConfirmPassword"] as const).map((name) => (
        <Controller
          key={name}
          name={name}
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor={`registration-${name}`}>{t(name)}</FieldLabel>
              <PasswordInput
                {...field}
                id={`registration-${name}`}
                autoComplete="new-password"
                aria-invalid={fieldState.invalid || undefined}
              />
              {fieldState.invalid ? (
                <FieldError>{passwordError(fieldState.error?.message, name)}</FieldError>
              ) : name === "adminPassword" ? (
                <FieldDescription>{t("passwordHint")}</FieldDescription>
              ) : null}
            </Field>
          )}
        />
      ))}
    </FieldGroup>
  );
}

function ReviewStep({
  form,
  onEdit,
  error,
}: {
  form: UseFormReturn<RegistrationFormValues, unknown, RegistrationInput>;
  onEdit: (step: number) => void;
  error: string | null;
}) {
  const t = useTranslations("registration");
  const tField = useTranslations("companyFields");
  const values = form.getValues();
  const stepIndex = (key: RegistrationStepKey) =>
    REGISTRATION_STEPS.findIndex((s) => s.key === key);

  const section = (key: RegistrationStepKey, rows: [string, ReactNode][]) => (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t(`steps.${key}.title`)}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(stepIndex(key))}>
          <PencilIcon />
          {t("review.edit")}
        </Button>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        {rows
          .filter(([, value]) => value !== "" && value !== null && value !== undefined)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );

  return (
    <FieldGroup>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${error as "unexpected"}`)}</AlertDescription>
        </Alert>
      ) : null}
      {section("basics", [
        [tField("name"), values.name],
        [tField("shortName"), values.shortName],
        [tField("legalForm"), values.legalForm],
        [tField("country"), countryName(values.country)],
        [tField("taxId"), values.taxId],
        [tField("vatId"), values.vatId],
        [tField("activity"), values.activity],
      ])}
      {section("contact", [
        [
          tField("address"),
          [values.address, [values.postalCode, values.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", "),
        ],
        [
          t("review.mail"),
          [values.mailAddress, [values.mailPostalCode, values.mailCity].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", "),
        ],
        [tField("phone"), values.phone],
        [tField("email"), values.email],
        [tField("website"), values.website],
      ])}
      {section(
        "banking",
        values.bankAccounts.length === 0
          ? [[t("review.bankAccounts"), t("review.none")]]
          : values.bankAccounts.map((account, index) => [
              `${account.bankName}${account.isPrimary ? ` (${t("review.primary")})` : ""}`,
              [account.accountNumber, account.iban].filter(Boolean).join(" · ") ||
                String(index + 1),
            ]),
      )}
      {section("system", [
        [
          t("system.slug"),
          <span key="slug" className="font-mono">
            {values.slug}.zcore.ba
          </span>,
        ],
        [t("system.timezone"), values.timezone],
      ])}
      {section("admin", [
        [t("admin.fullName"), values.adminFullName],
        [
          t("admin.username"),
          <span key="username" className="font-mono">
            {values.adminUsername}
          </span>,
        ],
      ])}
      <Controller
        name="acceptTerms"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid || undefined}>
            <div className="flex items-start gap-3">
              <Checkbox
                id="registration-terms"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked)}
                aria-invalid={fieldState.invalid || undefined}
              />
              <FieldLabel htmlFor="registration-terms" className="font-normal">
                {t("review.terms")}
              </FieldLabel>
            </div>
            {fieldState.invalid ? <FieldError>{t("review.termsRequired")}</FieldError> : null}
          </Field>
        )}
      />
    </FieldGroup>
  );
}

function SuccessCard({ success }: { success: Success }) {
  const t = useTranslations("registration.success");
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <CircleCheckBigIcon className="size-10 text-emerald-600" aria-hidden />
        <CardTitle className="text-xl">
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>{t("description", { days: success.trialDays })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {success.claim ? (
          <Alert>
            <AlertTitle>{t("claimTitle")}</AlertTitle>
            <AlertDescription>{t("claimDescription")}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-center text-sm">
          {t("username")} <span className="font-mono font-medium">{success.username}</span>
        </p>
        <a href={success.loginUrl} className={cn(buttonVariants({ size: "lg" }), "h-12 text-base")}>
          {t("login")}
        </a>
        <p className="text-center text-xs break-all text-muted-foreground">{success.loginUrl}</p>
      </CardContent>
    </Card>
  );
}
