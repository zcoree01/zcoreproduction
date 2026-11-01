"use client";

import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ScaleIcon,
  WarehouseIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDecimals, compareDecimals, formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { setStockItemArchivedAction } from "@/modules/inventory/actions";
import type { StockBalanceRow, StockItemDetail, StockLocation } from "@/modules/inventory/queries";
import { kgPerMetre } from "@/modules/inventory/rules";
import type { MaterialOption } from "@/modules/materials/schemas";
import { StockItemSheet } from "../stock-item-sheet";
import { useStockFormat } from "../use-stock-format";
import { LotsPanel } from "./lots-panel";
import { AdjustmentSheet, TransferSheet } from "./movement-sheets";

type Dialog =
  | { kind: "edit" }
  | { kind: "transfer"; balance: StockBalanceRow }
  | { kind: "adjust"; balance: StockBalanceRow | null };

const MOVEMENT_LIMIT = 200;

export function StockItemDetailView({
  detail,
  dateLabels,
  materials,
  locations,
  permissions,
}: {
  detail: StockItemDetail;
  /** Formatted on the server, by movement id and lot id. */
  dateLabels: { movements: Record<string, string>; lots: Record<string, string> };
  materials: MaterialOption[];
  locations: StockLocation[];
  permissions: { canManage: boolean; canMove: boolean; canApprove: boolean };
}) {
  const t = useTranslations("inventory");
  const format = useStockFormat();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, startTransition] = useTransition();
  const { item, balances, movements, lots } = detail;
  const canPropose = permissions.canMove || permissions.canApprove;
  const customerQuantity = addDecimals([item.quantity, `-${item.ownQuantity}`]);
  const perMetre = kgPerMetre(item, item.density);

  const setArchived = (archived: boolean) =>
    startTransition(async () => {
      const result = await setStockItemArchivedAction(item.id, archived);
      if (result.ok) {
        toast.success(
          t(archived ? "detail.archivedToast" : "detail.restoredToast", { name: item.name }),
        );
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/inventory"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
        >
          <ArrowLeftIcon />
          {t("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              {item.name}
              {item.archived ? <Badge variant="secondary">{t("list.archived")}</Badge> : null}
              {item.belowMinimum ? (
                <Badge variant="destructive">{t("list.belowMinimum")}</Badge>
              ) : null}
            </h1>
            <p className="text-sm text-muted-foreground">
              {[item.code, t(`shapes.${item.shape}`), item.grade, item.supplier]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {permissions.canManage ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialog({ kind: "edit" })}>
                <PencilIcon />
                {t("detail.edit")}
              </Button>
              {item.archived ? (
                <Button variant="outline" disabled={pending} onClick={() => setArchived(false)}>
                  <RotateCcwIcon />
                  {t("detail.restore")}
                </Button>
              ) : (
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" disabled={pending}>
                      <ArchiveIcon />
                      {t("detail.archive")}
                    </Button>
                  }
                  title={t("detail.archiveTitle")}
                  description={t("detail.archiveDescription")}
                  confirmLabel={t("detail.archive")}
                  onConfirm={() => setArchived(true)}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title={t("detail.summary.stock")}
          value={format.quantity(item.baseUnit, item.quantity)}
          note={
            compareDecimals(customerQuantity, "0") > 0
              ? t("list.customerPart", { value: format.quantity(item.baseUnit, customerQuantity) })
              : item.kgPerUnit
                ? format.kg(item.mass)
                : null
          }
        />
        <SummaryCard
          title={t("detail.summary.value")}
          value={format.money(item.ownValue)}
          note={item.kgPerUnit ? format.kg(item.ownMass) : null}
        />
        <SummaryCard
          title={t("detail.summary.costPerKg")}
          value={format.perKg(item.costPerKg)}
          note={perMetre ? t("itemForm.conversionM", { value: formatDecimal(perMetre) }) : null}
        />
        <SummaryCard
          title={t("detail.summary.minStock")}
          value={
            item.minStock
              ? format.quantity(item.baseUnit, item.minStock)
              : t("detail.summary.noMinimum")
          }
          note={item.belowMinimum ? t("list.belowMinimum") : null}
          warn={item.belowMinimum}
        />
      </div>

      <Tabs defaultValue="stock">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="stock" className="flex-none px-3">
            {t("detail.tabs.stock")}
          </TabsTrigger>
          <TabsTrigger value="movements" className="flex-none px-3">
            {t("detail.tabs.movements")}
            <span className="text-xs text-muted-foreground tabular-nums">{movements.length}</span>
          </TabsTrigger>
          <TabsTrigger value="certificates" className="flex-none px-3">
            {t("detail.tabs.certificates")}
            <span className="text-xs text-muted-foreground tabular-nums">{lots.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="flex flex-col gap-3 pt-2">
          {canPropose && !item.archived ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => setDialog({ kind: "adjust", balance: null })}
              >
                <PlusIcon />
                {t("detail.balances.found")}
              </Button>
            </div>
          ) : null}
          {balances.length === 0 ? (
            <EmptyState
              icon={<WarehouseIcon />}
              title={t("detail.balances.emptyTitle")}
              description={t("detail.balances.emptyDescription")}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("detail.balances.location")}</TableHead>
                    <TableHead>{t("detail.balances.lot")}</TableHead>
                    <TableHead>{t("detail.balances.owner")}</TableHead>
                    <TableHead className="text-right">{t("detail.balances.pieces")}</TableHead>
                    <TableHead className="text-right">{t("detail.balances.quantity")}</TableHead>
                    <TableHead className="text-right">{t("detail.balances.mass")}</TableHead>
                    {canPropose ? (
                      <TableHead>
                        <span className="sr-only">{t("detail.balances.actions")}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((balance) => (
                    <TableRow
                      key={`${balance.lotId}:${balance.locationId}:${balance.length}:${balance.width}`}
                    >
                      <TableCell>{balance.location}</TableCell>
                      <TableCell>
                        <div className="font-medium">{balance.lotNumber}</div>
                        {balance.heatNumber ? (
                          <div className="text-xs text-muted-foreground">
                            {t("detail.lots.heat", { heat: balance.heatNumber })}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {balance.ownerCustomer ? (
                          <Badge variant="outline">{balance.ownerCustomer}</Badge>
                        ) : (
                          <span className="text-muted-foreground">{t("detail.balances.own")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {format.pieces(balance.pieces, balance.length, balance.width)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {format.quantity(item.baseUnit, balance.quantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {format.kg(balance.mass)}
                      </TableCell>
                      {canPropose ? (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {permissions.canMove ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDialog({ kind: "transfer", balance })}
                              >
                                <ArrowRightLeftIcon />
                                {t("detail.balances.transfer")}
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDialog({ kind: "adjust", balance })}
                            >
                              <ScaleIcon />
                              {t("detail.balances.adjust")}
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="movements" className="flex flex-col gap-2 pt-2">
          {movements.length === 0 ? (
            <EmptyState icon={<HistoryIcon />} title={t("detail.movements.emptyTitle")} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("detail.movements.date")}</TableHead>
                      <TableHead>{t("detail.movements.document")}</TableHead>
                      <TableHead>{t("detail.movements.kind")}</TableHead>
                      <TableHead>{t("detail.movements.lot")}</TableHead>
                      <TableHead>{t("detail.movements.location")}</TableHead>
                      <TableHead className="text-right">{t("detail.movements.size")}</TableHead>
                      <TableHead className="text-right">{t("detail.movements.quantity")}</TableHead>
                      <TableHead className="text-right">{t("detail.movements.value")}</TableHead>
                      <TableHead>{t("detail.movements.actor")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell className="whitespace-nowrap">
                          {dateLabels.movements[movement.id]}
                        </TableCell>
                        <TableCell>{movement.documentNumber}</TableCell>
                        <TableCell>{t(`detail.movements.kinds.${movement.kind}`)}</TableCell>
                        <TableCell>{movement.lotNumber}</TableCell>
                        <TableCell>{movement.location}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {format.pieces(movement.pieces, movement.length, movement.width)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            compareDecimals(movement.quantity, "0") < 0 && "text-destructive",
                          )}
                        >
                          {format.quantity(item.baseUnit, movement.quantity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {format.money(movement.value)}
                        </TableCell>
                        <TableCell>{movement.actor ?? t("unknown")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {movements.length >= MOVEMENT_LIMIT ? (
                <p className="text-sm text-muted-foreground">
                  {t("detail.movements.limit", { count: MOVEMENT_LIMIT })}
                </p>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="certificates" className="pt-2">
          <LotsPanel lots={lots} dateLabels={dateLabels.lots} canUpload={permissions.canMove} />
        </TabsContent>
      </Tabs>

      {permissions.canManage ? (
        <StockItemSheet
          open={dialog?.kind === "edit"}
          onOpenChange={(open) => setDialog(open ? { kind: "edit" } : null)}
          item={item}
          locked={movements.length > 0}
          materials={materials}
          locations={locations}
        />
      ) : null}
      <TransferSheet
        item={item}
        balance={dialog?.kind === "transfer" ? dialog.balance : null}
        locations={locations}
        onClose={() => setDialog(null)}
      />
      <AdjustmentSheet
        item={item}
        open={dialog?.kind === "adjust"}
        balance={dialog?.kind === "adjust" ? dialog.balance : null}
        locations={locations}
        canPost={permissions.canApprove}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  note,
  warn,
}: {
  title: string;
  value: string;
  note: string | null;
  warn?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className={cn("text-xl tabular-nums", warn && "text-destructive")}>
          {value}
        </CardTitle>
      </CardHeader>
      {note ? (
        <CardContent className="-mt-2 text-sm text-muted-foreground">{note}</CardContent>
      ) : null}
    </Card>
  );
}
