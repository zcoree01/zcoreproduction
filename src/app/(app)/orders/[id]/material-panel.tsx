"use client";

import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  PackageXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compareDecimals, formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { confirmConsumptionAction } from "@/modules/inventory/actions";
import { materialDifference, missingPieces } from "@/modules/inventory/order-rules";
import type { OrderMaterial, StockLocation } from "@/modules/inventory/queries";
import { displayUnit, lineMass, toDisplayQuantity } from "@/modules/inventory/rules";
import { setOrderStatusAction } from "@/modules/production-orders/actions";
import { useStockFormat } from "../../inventory/use-stock-format";
import { IssueSheet, ReturnSheet } from "./material-sheets";

export type OrderMaterialView = OrderMaterial & {
  /** Movement dates formatted on the server, by movement id. */
  movementLabels: Record<string, string>;
};

export function MaterialPanel({
  order,
  material,
  locations,
  remnantMinLength,
  can,
}: {
  order: {
    id: string;
    orderNumber: string;
    quantity: string;
    customerId: string;
    pieceLength: string | null;
    kerf: string | null;
  };
  material: OrderMaterialView;
  locations: StockLocation[];
  remnantMinLength: string;
  can: { move: boolean; setWaiting: boolean };
}) {
  const t = useTranslations("inventory.orderMaterial");
  const tStatus = useTranslations("orders.status");
  const format = useStockFormat();
  const [dialog, setDialog] = useState<"issue" | "return" | null>(null);
  const [pending, startTransition] = useTransition();
  const { item, plan, reservation } = material;

  if (!item) {
    return (
      <EmptyState
        icon={<PackageXIcon />}
        title={t("noItemTitle")}
        description={t("noItemDescription")}
      />
    );
  }

  const unit = item.baseUnit;
  const quantity = (value: string) => format.quantity(unit, value);
  const consumed = material.consumption?.quantity ?? "0";
  const difference = materialDifference(material.issued, consumed, material.returned);
  const shortage = reservation?.shortage ?? "0";
  const missing = plan.perPiece ? missingPieces(shortage, plan.perPiece) : 0;

  const setWaiting = () =>
    startTransition(async () => {
      const result = await setOrderStatusAction(order.id, { status: "waiting_material" });
      if (result.ok) toast.success(t("waitingDone"));
      else toast.error(tStatus(`errors.${result.error}`));
    });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Link href={`/inventory/${item.id}`} className="hover:underline">
              {item.code} · {item.name}
            </Link>
          </CardTitle>
          <CardDescription>
            <Requirement material={material} order={order} />
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Figure
            label={t("reserved")}
            value={reservation ? quantity(reservation.quantity) : t("notReserved")}
          />
          <Figure label={t("issued")} value={quantity(material.issued)} />
          <Figure
            label={t("remaining")}
            value={reservation ? quantity(reservation.remaining) : "—"}
          />
          <Figure label={t("returned")} value={quantity(material.returned)} />
          <Figure
            label={t("consumed")}
            value={material.consumption ? quantity(material.consumption.quantity) : "—"}
          />
          <Figure
            label={t("difference")}
            value={quantity(difference)}
            warn={compareDecimals(difference, "0") < 0}
          />
        </CardContent>
      </Card>

      {compareDecimals(shortage, "0") > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("shortageTitle")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{t("shortage", { quantity: quantity(shortage), pieces: missing })}</span>
            {can.setWaiting ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={setWaiting}>
                {t("waitingMaterial")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {can.move ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("issue")}>
            <ArrowUpFromLineIcon />
            {t("issue")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("return")}>
            <ArrowDownToLineIcon />
            {t("return")}
          </Button>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t("movements")}</h3>
        {material.movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("movementsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.date")}</TableHead>
                  <TableHead>{t("columns.document")}</TableHead>
                  <TableHead>{t("columns.kind")}</TableHead>
                  <TableHead>{t("columns.lot")}</TableHead>
                  <TableHead>{t("columns.location")}</TableHead>
                  <TableHead className="text-right">{t("columns.size")}</TableHead>
                  <TableHead className="text-right">{t("columns.quantity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {material.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      {material.movementLabels[m.id]}
                    </TableCell>
                    <TableCell>{m.documentNumber}</TableCell>
                    <TableCell>
                      {t(`kinds.${m.kind}`)}
                      {m.cutPieces ? (
                        <div className="text-xs text-muted-foreground">
                          {t("cutPieces", { count: m.cutPieces })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {m.lotNumber}
                      {m.heatNumber ? (
                        <div className="text-xs text-muted-foreground">{m.heatNumber}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{m.location}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.pieces(
                        m.pieces === null ? null : Math.abs(m.pieces),
                        m.length,
                        m.width,
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        compareDecimals(m.quantity, "0") < 0 && "text-destructive",
                      )}
                    >
                      {quantity(m.quantity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Consumption orderId={order.id} itemId={item.id} material={material} canConfirm={can.move} />

      {can.move ? (
        <>
          <IssueSheet
            open={dialog === "issue"}
            onClose={() => setDialog(null)}
            order={order}
            material={material}
            locations={locations}
            remnantMinLength={remnantMinLength}
          />
          <ReturnSheet
            open={dialog === "return"}
            onClose={() => setDialog(null)}
            orderId={order.id}
            material={material}
            locations={locations}
          />
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", warn && "text-destructive")}>{value}</span>
    </div>
  );
}

function Requirement({
  material,
  order,
}: {
  material: OrderMaterialView;
  order: { quantity: string; pieceLength: string | null; kerf: string | null };
}) {
  const t = useTranslations("inventory.orderMaterial");
  const format = useStockFormat();
  const { plan, item } = material;
  if (!item || !plan.quantity || !plan.perPiece) return <span>{t("noRequirement")}</span>;
  const total = format.quantity(item.baseUnit, plan.quantity);
  const kg = lineMass(plan.quantity, item.kgPerUnit);
  const mass = kg ? ` · ${format.kg(kg)}` : "";
  const length = formatDecimal(order.pieceLength);
  const kerf = formatDecimal(order.kerf ?? "0");

  if (item.baseUnit === "mm") {
    return (
      <span className="flex flex-col gap-0.5">
        <span>
          {t("requirement")}:{" "}
          {t("calcBar", {
            quantity: formatDecimal(order.quantity),
            length,
            kerf,
            total: `${total}${mass}`,
          })}
        </span>
        {plan.piecesPerUnit && plan.unitsNeeded && plan.unitLength ? (
          <span>
            {t("calcBarUnits", {
              perUnit: plan.piecesPerUnit,
              unitLength: formatDecimal(plan.unitLength),
              units: plan.unitsNeeded,
            })}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        {t("requirement")}:{" "}
        {t("calcSheet", {
          quantity: formatDecimal(order.quantity),
          length,
          width: formatDecimal(plan.pieceWidth),
          kerf,
        })}
      </span>
      {plan.piecesPerUnit && plan.unitsNeeded && plan.unitLength && plan.unitWidth ? (
        <span>
          {t("calcSheetUnits", {
            perUnit: plan.piecesPerUnit,
            unitLength: formatDecimal(plan.unitLength),
            unitWidth: formatDecimal(plan.unitWidth),
            estimated: plan.estimated ? t("estimated") : "",
            units: plan.unitsNeeded,
            total: `${total}${mass}`,
          })}
        </span>
      ) : (
        <span>{`${total}${mass}`}</span>
      )}
    </span>
  );
}

function Consumption({
  orderId,
  itemId,
  material,
  canConfirm,
}: {
  orderId: string;
  itemId: string;
  material: OrderMaterialView;
  canConfirm: boolean;
}) {
  const t = useTranslations("inventory.orderMaterial");
  const tErrors = useTranslations("inventory.errors");
  const tUnits = useTranslations("inventory.displayUnits");
  const format = useStockFormat();
  const unit = material.item?.baseUnit ?? "mm";
  const proposal = material.plan.proposedConsumption;
  const display = (value: string | null) =>
    value === null ? "" : formatDecimal(toDisplayQuantity(unit, value));
  const [value, setValue] = useState(display(material.consumption?.quantity ?? null));
  const [note, setNote] = useState(material.consumption?.note ?? "");
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setInvalid(false);
    startTransition(async () => {
      const result = await confirmConsumptionAction(
        { orderId, itemId, quantity: value, note },
        unit,
      );
      if (result.ok) toast.success(t("confirmed"));
      else if (result.error === "invalid") setInvalid(true);
      else toast.error(tErrors(result.error));
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consumption")}</CardTitle>
        <CardDescription className="flex flex-col gap-0.5">
          <span>
            {proposal && material.plan.perPiece
              ? t("proposal", {
                  pieces: formatDecimal(material.plan.reportedPieces),
                  perPiece: format.quantity(unit, material.plan.perPiece),
                  quantity: format.quantity(unit, proposal),
                })
              : t("noProposal")}
          </span>
          {material.consumption ? (
            <span>
              {t("confirmedValue", {
                quantity: format.quantity(unit, material.consumption.quantity),
              })}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      {canConfirm ? (
        <CardContent>
          <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
            <Field className="w-48" data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="consumption-quantity">
                {t("consumedQuantity", { unit: tUnits(displayUnit(unit)) })}
              </FieldLabel>
              <Input
                id="consumption-quantity"
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={invalid || undefined}
              />
              {invalid ? <FieldError>{tErrors("invalid")}</FieldError> : null}
            </Field>
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="consumption-note">{t("consumedNote")}</FieldLabel>
              <Input
                id="consumption-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            {proposal ? (
              <Button type="button" variant="outline" onClick={() => setValue(display(proposal))}>
                {t("useProposal")}
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>
              {t("confirm")}
            </Button>
          </form>
          <FieldDescription className="mt-2">{t("difference")}</FieldDescription>
        </CardContent>
      ) : null}
    </Card>
  );
}
