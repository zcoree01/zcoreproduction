"use client";

import { HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { HistoryEntry, RevisionSummary } from "@/modules/products/queries";
import { SetCurrentRevisionButton } from "./product-actions";

type Labelled<T> = T & { createdLabel: string };

// Columns shown by name in "changed fields"; others fall back to the column name.
const FIELD_KEYS = [
  "part_number",
  "name",
  "customer_name",
  "product_type_id",
  "unit",
  "drawing_number",
  "description",
  "material_grade",
  "material_shape_id",
  "blank_geometry",
  "blank_diameter_mm",
  "blank_width_mm",
  "blank_height_mm",
  "blank_thickness_mm",
  "cut_length_mm",
  "kerf_mm",
  "net_mass_kg",
  "sequence",
  "operation_type_id",
  "machine_type_id",
  "machine_id",
  "external_company",
  "setup_time_min",
  "cycle_time_s",
  "notes",
  "title",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

export function HistoryPanel({
  productId,
  revisions,
  entries,
  canRestore,
}: {
  productId: string;
  revisions: Labelled<RevisionSummary>[];
  entries: Labelled<HistoryEntry>[];
  canRestore: boolean;
}) {
  const t = useTranslations("products.history");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("revisionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {revisions.map((revision) => (
              <li
                key={revision.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="flex items-center gap-2">
                  <Link
                    href={
                      revision.isCurrent
                        ? `/products/${productId}`
                        : `/products/${productId}?rev=${revision.id}`
                    }
                    className="font-mono font-medium underline-offset-4 hover:underline"
                  >
                    {t("revisionLabel", { revision: revision.revision })}
                  </Link>
                  {revision.isCurrent ? <Badge>{t("current")}</Badge> : null}
                  <span className="text-sm text-muted-foreground">
                    {t("createdAt", { date: revision.createdLabel })}
                  </span>
                </div>
                {canRestore && !revision.isCurrent ? (
                  <SetCurrentRevisionButton revisionId={revision.id} revision={revision.revision} />
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("changesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title={t("emptyTitle")} className="border-0" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">{t("columns.when")}</TableHead>
                  <TableHead className="w-36">{t("columns.who")}</TableHead>
                  <TableHead>{t("columns.what")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {entry.createdLabel}
                    </TableCell>
                    <TableCell className="text-sm">{entry.actor ?? t("system")}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span>{t(`events.${entry.event}`, { subject: entry.subject ?? "" })}</span>
                        {entry.fields.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {t("changedFields", {
                              fields: entry.fields
                                .map((field) => (isFieldKey(field) ? t(`fields.${field}`) : field))
                                .join(", "),
                            })}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
