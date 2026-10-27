"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { countryName } from "@/lib/countries";
import { decideCompanyChangeAction } from "@/modules/companies/actions";
import {
  COMPANY_FIELD_KEYS,
  COMPANY_FIELDS,
  type Company,
  type CompanyFieldKey,
} from "@/modules/companies/schemas";

export type ChangeRequestView = {
  id: string;
  kind: "update" | "claim";
  company: Company;
  changes: Record<string, string | null>;
  bankAccountsChanged: boolean;
  reason: string | null;
  requestedBy: string | null;
  createdAt: string;
};

const SNAKE_TO_FIELD = Object.fromEntries(
  COMPANY_FIELDS.map((field) => [COMPANY_FIELD_KEYS[field], field]),
) as Record<string, CompanyFieldKey>;

/** Pending change requests / claims with old → new values and approve / reject. */
export function ChangeRequestList({ requests }: { requests: ChangeRequestView[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {requests.map((request) => (
        <ChangeRequestItem key={request.id} request={request} />
      ))}
    </ul>
  );
}

function ChangeRequestItem({ request }: { request: ChangeRequestView }) {
  const t = useTranslations("changeRequests");
  const tField = useTranslations("companyFields");
  const format = useFormatter();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [pending, startTransition] = useTransition();

  const rows = Object.entries(request.changes)
    .map(([key, value]) => ({ field: SNAKE_TO_FIELD[key], value }))
    .filter((row): row is { field: CompanyFieldKey; value: string | null } => Boolean(row.field))
    .map((row) => ({
      ...row,
      before: request.company[row.field] ?? "",
      after: row.value ?? "",
    }))
    .filter((row) => request.kind === "claim" || row.before !== row.after);

  const decide = (approve: boolean) =>
    startTransition(async () => {
      const result = await decideCompanyChangeAction({ requestId: request.id, approve, note });
      if (result.ok) {
        toast.success(approve ? t("approvedToast") : t("rejectedToast"));
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{request.company.name}</span>
        <Badge variant={request.kind === "claim" ? "default" : "secondary"}>
          {t(`kind.${request.kind}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {[request.company.taxId, countryName(request.company.country)].join(" · ")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {format.dateTime(new Date(request.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </div>
      {request.requestedBy ? (
        <p className="text-sm text-muted-foreground">
          {t("requestedBy", { name: request.requestedBy })}
        </p>
      ) : null}
      {request.kind === "claim" ? <p className="text-sm">{t("claimDescription")}</p> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-4 font-normal">{t("field")}</th>
                <th className="py-1 pr-4 font-normal">{t("before")}</th>
                <th className="py-1 font-normal">{t("after")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.field} className="border-t align-top">
                  <td className="py-1.5 pr-4 text-muted-foreground">{tField(row.field)}</td>
                  <td className="py-1.5 pr-4 line-through decoration-muted-foreground/60">
                    {row.before || "—"}
                  </td>
                  <td className="py-1.5 font-medium">{row.after || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {request.bankAccountsChanged ? <p className="text-sm">{t("bankAccountsChanged")}</p> : null}
      {request.reason ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t("reason")}: </span>
          {request.reason}
        </p>
      ) : null}
      {rejecting ? (
        <Field>
          <FieldLabel htmlFor={`reject-note-${request.id}`}>{t("rejectNote")}</FieldLabel>
          <Textarea
            id={`reject-note-${request.id}`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {rejecting ? (
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => decide(false)}
              disabled={pending || note.trim() === ""}
            >
              <XIcon />
              {t("reject")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setRejecting(true)} disabled={pending}>
              <XIcon />
              {t("reject")}
            </Button>
            <Button onClick={() => decide(true)} disabled={pending}>
              <CheckIcon />
              {t("approve")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
