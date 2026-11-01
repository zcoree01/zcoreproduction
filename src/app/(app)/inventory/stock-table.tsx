"use client";

import { PackageSearchIcon, PlusIcon, TriangleAlertIcon, WarehouseIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compareDecimals, addDecimals } from "@/lib/decimal";
import { matchesAllWords } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { StockItemRow, StockLocation } from "@/modules/inventory/queries";
import type { MaterialOption } from "@/modules/materials/schemas";
import { StockItemSheet } from "./stock-item-sheet";
import { useStockFormat } from "./use-stock-format";

export function StockTable({
  items,
  materials,
  locations,
  canManage,
  canMove,
}: {
  items: StockItemRow[];
  materials: MaterialOption[];
  locations: StockLocation[];
  canManage: boolean;
  canMove: boolean;
}) {
  const t = useTranslations("inventory");
  const format = useStockFormat();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [belowOnly, setBelowOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (showArchived || !item.archived) &&
          (!belowOnly || item.belowMinimum) &&
          matchesAllWords(`${item.code} ${item.name} ${item.grade ?? ""}`, query),
      ),
    [items, query, belowOnly, showArchived],
  );
  const belowCount = items.filter((item) => item.belowMinimum).length;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("list.search")}
        aria-label={t("list.search")}
        className="w-full sm:w-72"
      />
      <Label className="flex items-center gap-2 text-sm font-normal">
        <Checkbox checked={belowOnly} onCheckedChange={(value) => setBelowOnly(value === true)} />
        {t("list.belowMinimumOnly")}
      </Label>
      <Label className="flex items-center gap-2 text-sm font-normal">
        <Checkbox
          checked={showArchived}
          onCheckedChange={(value) => setShowArchived(value === true)}
        />
        {t("list.showArchived")}
      </Label>
      <div className="ml-auto flex gap-2">
        {canMove ? (
          <Link
            href="/inventory/receipts/new"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            {t("list.receipt")}
          </Link>
        ) : null}
        {canManage ? (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("list.add")}
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {belowCount > 0 ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertDescription>{t("list.belowMinimumCount", { count: belowCount })}</AlertDescription>
        </Alert>
      ) : null}
      {toolbar}

      {items.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon />}
          title={t("list.emptyTitle")}
          description={t("list.emptyDescription")}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<PackageSearchIcon />}
          title={t("list.noMatchTitle")}
          description={t("list.noMatchDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("list.columns.code")}</TableHead>
                <TableHead>{t("list.columns.name")}</TableHead>
                <TableHead>{t("list.columns.shape")}</TableHead>
                <TableHead className="text-right">{t("list.columns.stock")}</TableHead>
                <TableHead className="text-right">{t("list.columns.reserved")}</TableHead>
                <TableHead className="text-right">{t("list.columns.available")}</TableHead>
                <TableHead className="text-right">{t("list.columns.mass")}</TableHead>
                <TableHead className="text-right">{t("list.columns.value")}</TableHead>
                <TableHead className="text-right">{t("list.columns.costPerKg")}</TableHead>
                <TableHead>{t("list.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => {
                const customerPart = addDecimals([item.quantity, `-${item.ownQuantity}`]);
                return (
                  <TableRow
                    key={item.id}
                    className={cn("cursor-pointer", item.archived && "opacity-60")}
                    onClick={() => router.push(`/inventory/${item.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/inventory/${item.id}`}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {item.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div>{item.name}</div>
                      {item.grade ? (
                        <div className="text-xs text-muted-foreground">{item.grade}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{t(`shapes.${item.shape}`)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{format.quantity(item.baseUnit, item.quantity)}</div>
                      {compareDecimals(customerPart, "0") > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {t("list.customerPart", {
                            value: format.quantity(item.baseUnit, customerPart),
                          })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {compareDecimals(item.reserved, "0") > 0
                        ? format.quantity(item.baseUnit, item.reserved)
                        : t("unknown")}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        compareDecimals(item.available, "0") < 0 && "font-medium text-destructive",
                      )}
                    >
                      {format.quantity(item.baseUnit, item.available)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.kgPerUnit ? format.kg(item.mass) : t("unknown")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.money(item.ownValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.perKg(item.costPerKg)}
                    </TableCell>
                    <TableCell>
                      {item.archived ? (
                        <Badge variant="secondary">{t("list.archived")}</Badge>
                      ) : item.belowMinimum ? (
                        <Badge variant="destructive">{t("list.belowMinimum")}</Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage ? (
        <StockItemSheet
          open={creating}
          onOpenChange={setCreating}
          item={null}
          locked={false}
          materials={materials}
          locations={locations}
        />
      ) : null}
    </div>
  );
}
