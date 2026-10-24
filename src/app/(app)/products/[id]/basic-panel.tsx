import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDecimal } from "@/lib/decimal";
import type { ProductDetail, ProductRevision } from "@/modules/products/queries";
import { blankWeightKg, lengthWithKerf } from "@/modules/products/rules";
import { BLANK_DIMENSIONS } from "@/modules/products/schemas";

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
  const [t, tUnit, tGeometry, tPlan] = await Promise.all([
    getTranslations("products.basic"),
    getTranslations("productUnits"),
    getTranslations("blankGeometry"),
    getTranslations("inspectionPlans"),
  ]);
  const geometry = revision.blankGeometry;
  const used = BLANK_DIMENSIONS[geometry ?? "other"];
  const weight = blankWeightKg(
    {
      geometry,
      diameter: revision.blankDiameter,
      width: revision.blankWidth,
      thickness: revision.blankThickness,
      length: revision.cutLength,
    },
    revision.material?.density ?? null,
  );
  const consumption = lengthWithKerf(revision.cutLength, revision.kerf);
  const diameterLabel =
    geometry === "tube"
      ? t("outerDiameter")
      : geometry === "hexagon"
        ? t("acrossFlats")
        : t("blankDiameter");

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
            <Item label={t("customer")}>
              {product.customer ? (
                <Link
                  href={`/customers/${product.customer.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {product.customer.name}
                </Link>
              ) : null}
            </Item>
            <Item label={t("type")}>{product.type?.name}</Item>
            <Item label={t("unit")}>{tUnit(product.unit)}</Item>
            <Item label={t("inspectionPlan")}>{tPlan(product.inspectionPlan)}</Item>
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
            <Item label={t("materialId")}>
              {revision.material ? (
                <span>
                  {revision.material.designation}{" "}
                  <span className="text-muted-foreground">({revision.material.groupName})</span>
                </span>
              ) : null}
            </Item>
            <Item label={t("density")}>
              {revision.material?.density
                ? `${formatDecimal(revision.material.density)} kg/dm³`
                : null}
            </Item>
            <Item label={t("blankGeometry")}>{geometry ? tGeometry(geometry) : null}</Item>
            {used.includes("blankDiameter") ? (
              <Item label={diameterLabel}>{measure(revision.blankDiameter, "mm")}</Item>
            ) : null}
            {used.includes("blankWidth") ? (
              <Item label={t("blankWidth")}>{measure(revision.blankWidth, "mm")}</Item>
            ) : null}
            {used.includes("blankThickness") ? (
              <Item label={geometry === "tube" ? t("wallThickness") : t("blankThickness")}>
                {measure(revision.blankThickness, "mm")}
              </Item>
            ) : null}
            <Item label={t("cutLength")}>{measure(revision.cutLength, "mm")}</Item>
            <Item label={t("kerf")}>{measure(revision.kerf, "mm")}</Item>
            <Item label={t("consumption")}>{measure(consumption, "mm")}</Item>
            <Item label={t("blankWeight")}>{measure(weight, "kg")}</Item>
            <Item label={t("netMass")}>{measure(revision.netMass, "kg")}</Item>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
