"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useFormState } from "react-hook-form";
import { toast } from "sonner";
import {
  CompanyBankingFields,
  CompanyBasicsFields,
  CompanyContactFields,
} from "@/components/shared/company/company-sections";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveOrganizationProfileAction } from "@/modules/companies/actions";
import {
  companyProfileSchema,
  type CompanyProfileFormValues,
  type CompanyProfileInput,
} from "@/modules/companies/schemas";

type SaveError = Extract<
  Awaited<ReturnType<typeof saveOrganizationProfileAction>>,
  { ok: false }
>["error"];

/** Own company data in three cards (same parts as the registration steps). */
export function CompanyProfileForm({
  initial,
  lockTaxId,
}: {
  initial: CompanyProfileFormValues;
  /** The ID number of a registered company changes only through Zcore. */
  lockTaxId: boolean;
}) {
  const t = useTranslations("companySettings");
  const router = useRouter();
  const [formError, setFormError] = useState<SaveError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CompanyProfileFormValues, unknown, CompanyProfileInput>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: initial,
  });
  const { isDirty } = useFormState({ control: form.control });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveOrganizationProfileAction(form.getValues());
      if (result.ok) {
        toast.success(result.status === "claim_pending" ? t("claimSentToast") : t("savedToast"));
        form.reset(form.getValues());
        router.refresh();
        return;
      }
      if (result.error === "company_owned" || result.error === "tax_id_taken") {
        form.setError("taxId", { type: "server", message: t(`errors.${result.error}`) });
      }
      setFormError(result.error);
    });
  });

  const section = (title: string, description: string, body: React.ReactNode) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid w-full max-w-3xl gap-6">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
        </Alert>
      ) : null}
      {section(
        t("basicsTitle"),
        t("basicsDescription"),
        <CompanyBasicsFields form={form} lockTaxId={lockTaxId} />,
      )}
      {section(t("contactTitle"), t("contactDescription"), <CompanyContactFields form={form} />)}
      {section(t("bankingTitle"), t("bankingDescription"), <CompanyBankingFields form={form} />)}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !isDirty}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
