import { InboxIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlatformReportRow } from "@/modules/platform/reports-queries";
import type { ReportsFilter } from "@/modules/platform/reports-schemas";
import { PROBLEM_CATEGORIES, PROBLEM_STATUSES } from "@/modules/support/problem-reports/schemas";
import { ReportStatusBadge } from "./report-badges";

const SNIPPET = 90;

export function ReportsTable({
  rows,
  filter,
  organizations,
}: {
  rows: PlatformReportRow[];
  filter: ReportsFilter;
  organizations: { id: string; name: string }[];
}) {
  const t = useTranslations("platformReports");
  const tCategories = useTranslations("problemReports.categories");
  const format = useFormatter();
  const filtered = Boolean(filter.status || filter.category || filter.org);

  return (
    <div className="flex flex-col gap-4">
      <form action="/platform/reports" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.status")}
          <NativeSelect name="status" defaultValue={filter.status ?? ""}>
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {PROBLEM_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {t(`statuses.${status}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.category")}
          <NativeSelect name="category" defaultValue={filter.category ?? ""}>
            <NativeSelectOption value="">{t("filters.all")}</NativeSelectOption>
            {PROBLEM_CATEGORIES.map((category) => (
              <NativeSelectOption key={category} value={category}>
                {tCategories(category)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.organization")}
          <NativeSelect name="org" defaultValue={filter.org ?? ""}>
            <NativeSelectOption value="">{t("filters.allOrganizations")}</NativeSelectOption>
            {organizations.map((org) => (
              <NativeSelectOption key={org.id} value={org.id}>
                {org.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline" size="sm">
          {t("filters.apply")}
        </Button>
        {filtered ? (
          <Link href="/platform/reports" className="text-sm underline-offset-4 hover:underline">
            {t("filters.clear")}
          </Link>
        ) : null}
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title={t(filtered ? "emptyFilteredTitle" : "emptyTitle")}
          description={t(filtered ? "emptyFilteredDescription" : "emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.organization")}</TableHead>
                <TableHead>{t("columns.category")}</TableHead>
                <TableHead>{t("columns.description")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.lastActivity")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="report-row">
                  <TableCell className="font-medium">
                    <Link href={`/platform/reports/${row.id}`} className="hover:underline">
                      {row.organizationName}
                    </Link>
                    {row.authorName ? (
                      <div className="text-xs font-normal text-muted-foreground">
                        {row.authorName}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{tCategories(row.category)}</TableCell>
                  <TableCell className="max-w-md text-muted-foreground">
                    {row.description
                      ? row.description.length > SNIPPET
                        ? `${row.description.slice(0, SNIPPET)}…`
                        : row.description
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <ReportStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format.dateTime(new Date(row.lastMessageAt ?? row.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Sarajevo",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
