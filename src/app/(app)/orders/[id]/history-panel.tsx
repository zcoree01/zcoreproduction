import { HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrderHistoryEntry, StatusLogEntry } from "@/modules/production-orders/queries";
import { isOperationStatus, isOrderStatus } from "@/modules/production-orders/status-rules";

type Labelled<T> = T & { createdLabel: string };

// Columns named in "changed fields"; others fall back to the column name.
const FIELD_KEYS = [
  "quantity",
  "due_date",
  "priority",
  "planned_start",
  "planned_end",
  "notes",
  "piece_length_mm",
  "kerf_mm",
  "bar_length_mm",
  "bar_remnant_mm",
  "machine_id",
  "description",
  "setup_time_min",
  "cycle_time_s",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function isFieldKey(value: string): value is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(value);
}

export function OrderHistoryPanel({
  statusLog,
  entries,
  externalSequences,
}: {
  statusLog: Labelled<StatusLogEntry>[];
  entries: Labelled<OrderHistoryEntry>[];
  /** Positions of external operations: their statuses are shipping steps. */
  externalSequences: number[];
}) {
  const t = useTranslations("orders.history");
  const tOrder = useTranslations("orderStatus");
  const tOperation = useTranslations("operationStatus");
  const tExternal = useTranslations("externalOperationStatus");
  const statusLabel = (value: string | null, operation: StatusLogEntry["operation"]) => {
    if (value === null) return "—";
    if (operation) {
      if (!isOperationStatus(value)) return value;
      return externalSequences.includes(operation.sequence) ? tExternal(value) : tOperation(value);
    }
    return isOrderStatus(value) ? tOrder(value) : value;
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("statusTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {statusLog.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title={t("statusEmpty")} className="border-0" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("when")}</TableHead>
                  <TableHead>{t("who")}</TableHead>
                  <TableHead>{t("what")}</TableHead>
                  <TableHead>{t("change")}</TableHead>
                  <TableHead>{t("reason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusLog.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {entry.createdLabel}
                    </TableCell>
                    <TableCell>{entry.actor ?? t("system")}</TableCell>
                    <TableCell>
                      {entry.operation
                        ? t("operation", { code: entry.operation.code })
                        : t("order")}
                    </TableCell>
                    <TableCell>
                      {statusLabel(entry.from, entry.operation)} →{" "}
                      <span className="font-medium">{statusLabel(entry.to, entry.operation)}</span>
                    </TableCell>
                    <TableCell className="whitespace-pre-line">{entry.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("changesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title={t("changesEmpty")} className="border-0" />
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 text-sm">
                  <span>
                    {t(`events.${entry.event}`, { subject: entry.subject ?? "" })}
                    {entry.fields.length > 0
                      ? `: ${entry.fields
                          .map((field) => (isFieldKey(field) ? t(`fields.${field}`) : field))
                          .join(", ")}`
                      : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.createdLabel} · {entry.actor ?? t("system")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
