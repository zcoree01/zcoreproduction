"use client";

import { useTranslations } from "next-intl";
import { divideDecimal, formatDecimal } from "@/lib/decimal";
import { displayUnit, toDisplayQuantity, type BaseUnit } from "@/modules/inventory/rules";

/** Display helpers for quantities, piece sizes, masses and money (decimal comma). */
export function useStockFormat() {
  const t = useTranslations("inventory");

  const quantity = (unit: BaseUnit, value: string) =>
    t("quantity", {
      value: formatDecimal(toDisplayQuantity(unit, value)),
      unit: t(`displayUnits.${displayUnit(unit)}`),
    });

  const size = (length: string | null, width: string | null) => {
    if (!length) return t("unknown");
    return width
      ? t("sheetSize", { length: formatDecimal(length), width: formatDecimal(width) })
      : t("barSize", { length: formatDecimal(length) });
  };

  const pieces = (count: number | null, length: string | null, width: string | null) =>
    count === null ? t("unknown") : t("piecesOf", { pieces: count, size: size(length, width) });

  const kg = (value: string | null) =>
    value === null ? t("unknown") : t("kg", { value: formatDecimal(divideDecimal(value, "1", 1)) });

  const money = (value: string | null) =>
    value === null
      ? t("unknown")
      : t("money", { value: formatDecimal(divideDecimal(value, "1", 2)) });

  const perKg = (value: string | null) =>
    value === null ? t("unknown") : t("perKg", { value: formatDecimal(value) });

  return { quantity, size, pieces, kg, money, perKg };
}
