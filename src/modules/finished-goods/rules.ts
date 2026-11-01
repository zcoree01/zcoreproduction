import { z } from "zod";
import { addDecimals, compareDecimals } from "@/lib/decimal";

// Finished goods and delivery notes (D-034). The database is authoritative
// (private.format_delivery_number, receive_finished_goods); these mirror it
// for previews and forms.

export const DEFAULT_DELIVERY_NUMBER_TEMPLATE = "{KUPAC2}-{MJESEC}{GODINA}-{BROJ}";
export const DELIVERY_NUMBER_TOKENS = [
  "KUPAC2",
  "KUPAC",
  "MJESEC",
  "GODINA4",
  "GODINA",
  "BROJ",
] as const;

/** Mirrors private.valid_delivery_number_template. */
export function isValidDeliveryNumberTemplate(template: string): boolean {
  if (template.length < 1 || template.length > 60 || !template.includes("{BROJ}")) return false;
  const rest = template.replace(/\{(KUPAC2|KUPAC|MJESEC|GODINA4|GODINA|BROJ)\}/g, "");
  return /^[A-Za-z0-9./_ -]*$/.test(rest);
}

const pad = (value: number, digits: number) => String(value).padStart(digits, "0");

/** Mirrors private.format_delivery_number (date as YYYY-MM-DD). */
export function formatDeliveryNumber(input: {
  template: string;
  digits: number;
  customerNumber: number;
  date: string;
  sequence: number;
}): string {
  const [year = "", month = ""] = input.date.split("-");
  return input.template
    .replaceAll("{KUPAC2}", pad(input.customerNumber, 2))
    .replaceAll("{KUPAC}", String(input.customerNumber))
    .replaceAll("{MJESEC}", month)
    .replaceAll("{GODINA4}", year)
    .replaceAll("{GODINA}", year.slice(-2))
    .replaceAll("{BROJ}", pad(input.sequence, input.digits));
}

export type DeliveryNumberSettings = { template: string; digits: number };

export function deliveryNumberSettingsFrom(settings: unknown): DeliveryNumberSettings {
  const value =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const template = value.delivery_note_number_template;
  const digits = value.delivery_note_number_digits;
  return {
    template:
      typeof template === "string" && isValidDeliveryNumberTemplate(template)
        ? template
        : DEFAULT_DELIVERY_NUMBER_TEMPLATE,
    digits:
      typeof digits === "number" && Number.isInteger(digits) && digits >= 1 && digits <= 6
        ? digits
        : 1,
  };
}

/** Good pieces of the last operation not yet received into finished goods. */
export function receivable(good: string, received: string): string {
  const rest = addDecimals([good, `-${received}`], 3);
  return compareDecimals(rest, "0") > 0 ? rest : "0";
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const DELIVERY_COLUMNS = [
  "position",
  "customer_position",
  "order",
  "part_number",
  "drawing",
  "revision",
  "product",
  "quantity",
  "unit",
] as const;
export type DeliveryColumn = (typeof DELIVERY_COLUMNS)[number];

const text = (max: number) => z.string().max(max);

export const deliveryTemplateLayoutSchema = z.object({
  title: z.string().trim().min(1).max(80),
  header_text: text(2000),
  footer_text: text(2000),
  show_logo: z.boolean(),
  columns: z
    .array(z.object({ key: z.enum(DELIVERY_COLUMNS), label: z.string().trim().min(1).max(40) }))
    .min(1)
    .max(DELIVERY_COLUMNS.length)
    .refine((columns) => new Set(columns.map((c) => c.key)).size === columns.length),
  signatures: z.array(z.string().trim().min(1).max(40)).max(4),
});
export type DeliveryTemplateLayout = z.infer<typeof deliveryTemplateLayoutSchema>;

export const DEFAULT_COLUMN_LABELS: Record<DeliveryColumn, string> = {
  position: "Poz.",
  customer_position: "Pozicija kupca",
  order: "Broj naloga",
  part_number: "Šifra dijela",
  drawing: "Broj crteža",
  revision: "Revizija",
  product: "Naziv",
  quantity: "Količina",
  unit: "J. mj.",
};

export const DEFAULT_LAYOUT: DeliveryTemplateLayout = {
  title: "Otpremnica",
  header_text: "",
  footer_text: "",
  show_logo: true,
  columns: (
    ["position", "customer_position", "order", "drawing", "product", "quantity"] as const
  ).map((key) => ({ key, label: DEFAULT_COLUMN_LABELS[key] })),
  signatures: ["Izdao", "Preuzeo"],
};

/** A stored layout, or the default when it does not validate. */
export function layoutFrom(value: unknown): DeliveryTemplateLayout {
  const parsed = deliveryTemplateLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LAYOUT;
}

export type DeliveryLineData = {
  lineNo: number;
  customerPosition: string | null;
  orderNumber: string;
  partNumber: string;
  drawingNumber: string | null;
  revision: string | null;
  productName: string;
  quantity: string;
  unit: string;
};

/** Cell text of a column for one line (unit labels are passed in). */
export function columnValue(
  column: DeliveryColumn,
  line: DeliveryLineData,
  formatQuantity: (value: string) => string,
  unitLabel: (unit: string) => string,
): string {
  switch (column) {
    case "position":
      return String(line.lineNo);
    case "customer_position":
      return line.customerPosition ?? "";
    case "order":
      return line.orderNumber;
    case "part_number":
      return line.partNumber;
    case "drawing":
      return line.drawingNumber ?? line.partNumber;
    case "revision":
      return line.revision ?? "";
    case "product":
      return line.productName;
    case "quantity":
      return formatQuantity(line.quantity);
    case "unit":
      return unitLabel(line.unit);
  }
}

/** Storage path of the organization logo: <organization>/logo-<id>.<ext>. */
export function logoStoragePath(organizationId: string, fileId: string, extension: string) {
  return `${organizationId}/logo-${fileId}.${extension}`;
}

export function isLogoStoragePath(path: string, organizationId: string) {
  return new RegExp(`^${organizationId}/logo-[0-9a-f-]{36}\\.(png|jpg|webp|svg)$`).test(path);
}
