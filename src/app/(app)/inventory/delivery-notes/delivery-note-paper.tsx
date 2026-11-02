import { useTranslations } from "next-intl";
import Image from "next/image";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import {
  columnValue,
  type DeliveryLineData,
  type DeliveryTemplateLayout,
} from "@/modules/finished-goods/rules";

export type DeliveryNotePaperProps = {
  organizationName: string;
  logoUrl: string | null;
  layout: DeliveryTemplateLayout;
  number: string;
  /** Formatted issue date. */
  date: string;
  cancelled?: boolean;
  customer: { name: string; address: string | null; city: string | null; taxId: string | null };
  lines: DeliveryLineData[];
  notes: string | null;
  /** "ORIGINAL" / "KOPIJA" in the corner, when printing several copies. */
  copyLabel?: string;
  className?: string;
};

/**
 * One delivery note on paper (A4 proportions), laid out by its template
 * (D-034): logo, title, number and date, customer, header text, the
 * template's columns, notes, footer text and signature lines. Used by the
 * print page, the note's page and the live preview of a new note, so all
 * three look the same. Always black on white, also in dark mode.
 */
export function DeliveryNotePaper({
  organizationName,
  logoUrl,
  layout,
  number,
  date,
  cancelled = false,
  customer,
  lines,
  notes,
  copyLabel,
  className,
}: DeliveryNotePaperProps) {
  const t = useTranslations("finishedGoods.print");
  const tUnits = useTranslations("productUnits");
  const unit = (value: string) => tUnits(value as "pcs");

  return (
    <article
      className={cn("relative flex flex-col gap-6 bg-white p-[12mm] text-sm text-black", className)}
      data-testid="delivery-note-paper"
    >
      {copyLabel ? (
        <span className="absolute top-[6mm] right-[12mm] text-xs font-semibold tracking-widest">
          {copyLabel}
        </span>
      ) : null}
      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          {logoUrl ? (
            // Signed URL of the organization's own logo (private bucket, not optimized).
            <Image
              src={logoUrl}
              alt={organizationName}
              width={224}
              height={64}
              unoptimized
              className="h-16 w-auto max-w-56 object-contain"
            />
          ) : null}
          <span className="font-semibold">{organizationName}</span>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold">{layout.title}</h2>
          <p>
            {t("number")}: <strong className="font-mono">{number}</strong>
          </p>
          <p>
            {t("date")}: {date}
          </p>
          {cancelled ? <p className="mt-1 font-bold text-red-700">{t("cancelled")}</p> : null}
        </div>
      </header>

      <section className="flex flex-col">
        <span className="text-xs uppercase">{t("customer")}</span>
        <span className="text-base font-semibold">{customer.name}</span>
        {customer.address ? <span>{customer.address}</span> : null}
        {customer.city ? <span>{customer.city}</span> : null}
        {customer.taxId ? <span>{t("taxId", { taxId: customer.taxId })}</span> : null}
      </section>

      {layout.header_text ? <p className="whitespace-pre-line">{layout.header_text}</p> : null}

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {layout.columns.map((column) => (
              <th key={column.key} className="border border-black px-2 py-1 text-left">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td
                colSpan={layout.columns.length}
                className="border border-black px-2 py-3 text-center text-neutral-500"
              >
                {t("noLines")}
              </td>
            </tr>
          ) : (
            lines.map((line) => (
              <tr key={line.lineNo}>
                {layout.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "border border-black px-2 py-1",
                      column.key === "quantity" && "text-right tabular-nums",
                    )}
                  >
                    {columnValue(
                      column.key,
                      line,
                      (value) => `${formatDecimal(value)} ${unit(line.unit)}`,
                      unit,
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {notes ? <p className="whitespace-pre-line">{notes}</p> : null}
      {layout.footer_text ? <p className="whitespace-pre-line">{layout.footer_text}</p> : null}

      {layout.signatures.length > 0 ? (
        <footer className="mt-auto flex justify-between gap-8 pt-16">
          {layout.signatures.map((label) => (
            <div key={label} className="flex min-w-40 flex-1 flex-col items-center">
              <span className="w-full border-t border-black" />
              <span className="mt-1">{t("signature", { label })}</span>
            </div>
          ))}
        </footer>
      ) : null}
    </article>
  );
}
