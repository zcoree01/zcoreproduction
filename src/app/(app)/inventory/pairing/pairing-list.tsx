"use client";

import { CheckCheckIcon, Link2Icon, PackageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDecimal } from "@/lib/decimal";
import { autoPairAction, linkRevisionStockItemAction } from "@/modules/inventory/actions";
import type { PairingRevision, StockItem } from "@/modules/inventory/queries";

type Row = PairingRevision & { candidateIds: string[] };

export function PairingList({ rows, items }: { rows: Row[]; items: StockItem[] }) {
  const t = useTranslations("inventory.pairing");
  const tShapes = useTranslations("blankGeometry");
  const [showAll, setShowAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const unpaired = rows.filter((row) => !row.stockItemId);
  const visible = showAll ? rows : unpaired;
  const itemLabel = (item: StockItem) => `${item.code} · ${item.name}`;

  const autoPair = () =>
    startTransition(async () => {
      const result = await autoPairAction();
      if (result.ok) toast.success(t("autoPaired", { count: result.paired }));
      else toast.error(t(`errors.${result.error}`));
    });

  const link = (row: Row, stockItemId: string) =>
    startTransition(async () => {
      const result = await linkRevisionStockItemAction(row.revisionId, stockItemId || null);
      if (result.ok) toast.success(t("saved"));
      else toast.error(t(`errors.${result.error}`));
    });

  const blank = (row: Row) => {
    if (!row.materialId || !row.geometry || row.geometry === "other") return t("noBlank");
    const dims = [row.diameter, row.width, row.thickness]
      .filter((value) => value !== null)
      .map((value) => formatDecimal(value))
      .join(" × ");
    return [row.grade, tShapes(row.geometry), dims].filter(Boolean).join(" · ");
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<PackageIcon />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {unpaired.length > 0 ? (
        <Alert>
          <Link2Icon />
          <AlertDescription>{t("unpairedCount", { count: unpaired.length })}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox checked={showAll} onCheckedChange={(value) => setShowAll(value === true)} />
          {t("showAll")}
        </Label>
        <Button onClick={autoPair} disabled={pending || unpaired.length === 0}>
          <CheckCheckIcon />
          {t("autoPair")}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<CheckCheckIcon />}
          title={t("allPairedTitle")}
          description={t("allPairedDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.product")}</TableHead>
                <TableHead>{t("columns.blank")}</TableHead>
                <TableHead className="w-96">{t("columns.stockItem")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const candidates = items.filter((item) => row.candidateIds.includes(item.id));
                const others = items.filter((item) => !row.candidateIds.includes(item.id));
                return (
                  <TableRow key={row.revisionId}>
                    <TableCell>
                      <Link
                        href={`/products/${row.productId}`}
                        className="font-medium hover:underline"
                      >
                        {row.partNumber}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {row.productName}
                        {row.revision ? ` · ${row.revision}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{blank(row)}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("candidates", { count: candidates.length })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        className="w-full"
                        aria-label={t("columns.stockItem")}
                        value={row.stockItemId ?? ""}
                        disabled={pending}
                        onChange={(event) => link(row, event.target.value)}
                      >
                        <NativeSelectOption value="">
                          {row.stockItemId ? t("none") : t("choose")}
                        </NativeSelectOption>
                        {candidates.length > 0 ? (
                          <NativeSelectOptGroup label={t("match")}>
                            {candidates.map((item) => (
                              <NativeSelectOption key={item.id} value={item.id}>
                                {itemLabel(item)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelectOptGroup>
                        ) : null}
                        {others.map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {itemLabel(item)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
