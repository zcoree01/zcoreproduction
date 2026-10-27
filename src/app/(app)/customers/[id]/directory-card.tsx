"use client";

import { BadgeCheckIcon, PencilLineIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { requestCompanyChangeAction } from "@/modules/companies/actions";
import type { Company, CompanyFieldKey } from "@/modules/companies/schemas";

// Fields a proposal may change (bank accounts are maintained by the company itself).
const PROPOSAL_FIELDS: readonly CompanyFieldKey[] = [
  "name",
  "vatId",
  "address",
  "postalCode",
  "city",
  "mailAddress",
  "mailPostalCode",
  "mailCity",
  "phone",
  "email",
  "website",
];

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">
        {children || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/** Public data of the linked directory entry, with a change proposal. */
export function DirectoryCard({ company, canPropose }: { company: Company; canPropose: boolean }) {
  const t = useTranslations("companyDirectory");
  const tField = useTranslations("companyFields");
  const [proposing, setProposing] = useState(false);

  const mail = [
    company.mailAddress,
    [company.mailPostalCode, company.mailCity].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("title")}
          {company.registered ? (
            <Badge variant="secondary">
              <BadgeCheckIcon />
              {t("registered")}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {company.registered ? t("registeredDescription") : t("description")}
        </CardDescription>
        {canPropose ? (
          <CardAction>
            <Button variant="outline" onClick={() => setProposing(true)}>
              <PencilLineIcon />
              {t("propose")}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label={tField("legalForm")}>{company.legalForm}</Item>
          <Item label={tField("vatId")}>{company.vatId}</Item>
          <Item label={tField("mailAddress")}>{mail}</Item>
          <Item label={tField("website")}>{company.website}</Item>
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("bankAccounts")}</h3>
          {company.bankAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noBankAccounts")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {company.bankAccounts.map((account, index) => (
                <li key={index} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    {account.bankName}
                    {account.isPrimary ? <Badge variant="outline">{t("primary")}</Badge> : null}
                  </div>
                  {account.accountNumber ? (
                    <div className="font-mono tabular-nums">{account.accountNumber}</div>
                  ) : null}
                  {account.iban ? (
                    <div className="font-mono text-xs text-muted-foreground">
                      IBAN {account.iban}
                      {account.swift ? ` · SWIFT ${account.swift}` : ""}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
      {canPropose ? (
        <ProposalSheet company={company} open={proposing} onOpenChange={setProposing} />
      ) : null}
    </Card>
  );
}

function ProposalSheet({
  company,
  open,
  onOpenChange,
}: {
  company: Company;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("companyDirectory.proposal");
  const tField = useTranslations("companyFields");
  const initial = Object.fromEntries(
    PROPOSAL_FIELDS.map((field) => [field, company[field] ?? ""]),
  ) as Record<CompanyFieldKey, string>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = PROPOSAL_FIELDS.filter((field) => values[field].trim() !== initial[field].trim());

  const submit = () => {
    setError(null);
    if (changed.length === 0) {
      setError(t("nothingChanged"));
      return;
    }
    startTransition(async () => {
      const result = await requestCompanyChangeAction({
        companyId: company.id,
        changes: Object.fromEntries(changed.map((field) => [field, values[field]])),
        reason,
      });
      if (result.ok) {
        toast.success(t("sent"));
        onOpenChange(false);
        setValues(initial);
        setReason("");
      } else {
        setError(t(`errors.${result.error}`));
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("title", { name: company.name })}</SheetTitle>
          <SheetDescription>
            {company.registered ? t("descriptionRegistered") : t("description")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {PROPOSAL_FIELDS.map((field) => (
              <Field key={field}>
                <FieldLabel htmlFor={`proposal-${field}`}>{tField(field)}</FieldLabel>
                <Input
                  id={`proposal-${field}`}
                  value={values[field]}
                  onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                  autoComplete="off"
                />
                {changed.includes(field) ? (
                  <FieldDescription>{t("was", { value: initial[field] || "—" })}</FieldDescription>
                ) : null}
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor="proposal-reason">{t("reason")}</FieldLabel>
              <Textarea
                id="proposal-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <FieldDescription>{t("reasonHint")}</FieldDescription>
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter className="border-t">
          <Button onClick={submit} disabled={pending}>
            {pending ? t("sending") : t("submit", { count: changed.length })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
