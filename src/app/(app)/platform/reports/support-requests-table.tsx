import { LifeBuoyIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlatformSupportRow } from "@/modules/platform/reports-queries";
import { SessionStatusBadge } from "./report-badges";

/** Whole minutes left of an approved / active access, or null. */
function minutesLeft(row: PlatformSupportRow, now: number): number | null {
  if ((row.status !== "approved" && row.status !== "active") || !row.approvedUntil) return null;
  return Math.max(0, Math.ceil((new Date(row.approvedUntil).getTime() - now) / 60_000));
}

export function SupportRequestsTable({
  rows,
  now,
}: {
  rows: PlatformSupportRow[];
  /** Epoch ms, taken once by the page. */
  now: number;
}) {
  const t = useTranslations("platformReports.support");
  const tSupport = useTranslations("support");
  const format = useFormatter();
  const when = (value: string) =>
    format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Sarajevo",
    });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<LifeBuoyIcon />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.organization")}</TableHead>
            <TableHead>{t("columns.requestedBy")}</TableHead>
            <TableHead>{t("columns.reason")}</TableHead>
            <TableHead>{t("columns.when")}</TableHead>
            <TableHead>{t("columns.window")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.remaining")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const left = minutesLeft(row, now);
            return (
              <TableRow key={row.id} data-testid="support-row">
                <TableCell className="font-medium">
                  <Link
                    href={`/platform/organizations/${row.organizationId}`}
                    className="hover:underline"
                  >
                    {row.organizationName}
                  </Link>
                </TableCell>
                <TableCell>{row.requesterName}</TableCell>
                <TableCell className="max-w-xs text-muted-foreground">{row.reason}</TableCell>
                <TableCell className="whitespace-nowrap">{when(row.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.scheduledStart && row.durationMinutes
                    ? t("window", {
                        start: when(row.scheduledStart),
                        duration: tSupport("minutes", { minutes: row.durationMinutes }),
                      })
                    : row.durationMinutes
                      ? tSupport("minutes", { minutes: row.durationMinutes })
                      : "—"}
                </TableCell>
                <TableCell>
                  <SessionStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {left === null ? "—" : t("remaining", { minutes: left })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
