import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimal } from "@/lib/decimal";
import type { ProductDetail, ProductRevision } from "@/modules/products/queries";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function measure(value: string | null, unit: string) {
  return value === null ? null : `${formatDecimal(value)} ${unit}`;
}

export async function BasicPanel({
  product,
  revision,
}: {
  product: ProductDetail;
  revision: ProductRevision;
}) {
  const [t, tUnit, tGeometry] = await Promise.all([
    getTranslations("products.basic"),
    getTranslations("productUnits"),
    getTranslations("blankGeometry"),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("product")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item label={t("partNumber")}>
              <span className="font-mono">{product.partNumber}</span>
            </Item>
            <Item label={t("name")}>{product.name}</Item>
            <Item label={t("customer")}>{product.customerName}</Item>
            <Item label={t("type")}>{product.type?.name}</Item>
            <Item label={t("unit")}>{tUnit(product.unit)}</Item>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("drawing")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item label={t("drawingNumber")}>{revision.drawingNumber}</Item>
            <Item label={t("revision")}>{revision.revision}</Item>
            <div className="sm:col-span-2">
              <Item label={t("description")}>
                {revision.description ? (
                  <span className="whitespace-pre-line">{revision.description}</span>
                ) : null}
              </Item>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("material")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Item label={t("materialGrade")}>{revision.materialGrade}</Item>
            <Item label={t("materialShape")}>{revision.materialShape?.name}</Item>
            <Item label={t("blankGeometry")}>
              {revision.blankGeometry ? tGeometry(revision.blankGeometry) : null}
            </Item>
            {revision.blankGeometry === "round" ? (
              <Item label={t("blankDiameter")}>{measure(revision.blankDiameter, "mm")}</Item>
            ) : null}
            {revision.blankGeometry ? (
              <>
                <Item label={t("blankWidth")}>{measure(revision.blankWidth, "mm")}</Item>
                <Item label={t("blankHeight")}>{measure(revision.blankHeight, "mm")}</Item>
              </>
            ) : null}
            {revision.blankGeometry === "prismatic" ? (
              <Item label={t("blankThickness")}>{measure(revision.blankThickness, "mm")}</Item>
            ) : null}
            <Item label={t("cutLength")}>{measure(revision.cutLength, "mm")}</Item>
            <Item label={t("kerf")}>{measure(revision.kerf, "mm")}</Item>
            <Item label={t("netMass")}>{measure(revision.netMass, "kg")}</Item>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
