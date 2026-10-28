import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { z } from "zod";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDay } from "@/lib/format";
import { zonedDate } from "@/lib/timezone";
import { getMonthOverview } from "@/modules/attendance/month-overview";

// "Specifikacija uz isplatu plaće" (FBiH) for a month, prepared for the
// accountant: the employer, the period and the number of employees are
// filled in; amounts, contributions and tax stay empty because the company
// keeps net pay only (no gross / contribution calculation in Zcore).

export default function SpecificationPage({
  searchParams,
}: PageProps<"/attendance/specification">) {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <SpecificationContent searchParams={searchParams} />
    </Suspense>
  );
}

function Box({
  label,
  children,
  className,
}: {
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col border border-black px-2 py-1 ${className ?? ""}`}>
      <span className="text-[10px] font-semibold">{label}</span>
      <span className="min-h-5 text-[12px]">{children}</span>
    </div>
  );
}

const PART_2 = [
  ["14", "pension", "17.000%"],
  ["15", "health", "12.500%"],
  ["16", "unemployment", "1.500%"],
  ["17", "total2", "31.000%"],
] as const;
const PART_3 = [
  ["18", "pension", "6.000%"],
  ["19", "health", "4.000%"],
  ["20", "unemployment", "0.500%"],
  ["21", "extraPension", "0.000%"],
  ["22", "extraHealth", "0.000%"],
  ["23", "total3", "10.500%"],
] as const;
const PART_4 = [
  ["24", "obligationPension"],
  ["25", "obligationHealth"],
  ["26", "obligationUnemployment"],
  ["27", "incomeTax"],
  ["28", "obligationsTotal"],
] as const;

async function SpecificationContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireMember();
  const timeZone = member.organization.timezone;
  const [t, access] = await Promise.all([
    getTranslations("specification"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("attendance") || !access.permissions.has("attendance.read")) {
    return <p className="p-8">{t("denied")}</p>;
  }
  const params = await searchParams;
  const now = new Date();
  const today = zonedDate(now, timeZone);
  const month = z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .catch(today.slice(0, 7))
    .parse(Array.isArray(params.month) ? params.month[0] : params.month);
  const overview = await getMonthOverview(member.organization.id, month, timeZone, today, now);
  if (!overview) return <p className="p-8">{t("denied")}</p>;
  const employees = overview.rows.filter((row) => row.totals.workedMin > 0).length;

  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4 p-6 print:p-0">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link
          href={`/attendance/monthly?month=${month}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>
      <p className="rounded border border-amber-500 bg-amber-50 p-2 text-xs print:hidden">
        {t("netNote")}
      </p>

      <h1 className="text-center text-sm font-bold">{t("title")}</h1>
      <section className="flex flex-col gap-1">
        <h2 className="text-center text-xs font-bold">{t("part1")}</h2>
        <div className="grid grid-cols-2 gap-1">
          <Box label={t("fields.name")}>{member.organization.name}</Box>
          <Box label={t("fields.taxId")} />
          <Box label={t("fields.address")} />
          <Box label={t("fields.municipality")} />
          <Box label={t("fields.activity")} />
          <Box label={t("fields.period")}>
            {formatDay(overview.from)} – {formatDay(overview.to)}
          </Box>
          <Box label={t("fields.employees")}>{employees}</Box>
          <Box label={t("fields.cashPay")} />
          <Box label={t("fields.inKindPay")} />
          <Box label={t("fields.totalPay")} />
        </div>
        <Box label={t("fields.paymentType")}>{t("paymentTypeValue")}</Box>
      </section>

      {(
        [
          ["part2", PART_2],
          ["part3", PART_3],
        ] as const
      ).map(([part, lines]) => (
        <section key={part} className="flex flex-col gap-1">
          <h2 className="text-center text-xs font-bold">{t(part)}</h2>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="w-12 border border-black px-1">{t("columns.number")}</th>
                <th className="border border-black px-1">{t("columns.description")}</th>
                <th className="w-24 border border-black px-1">{t("columns.rate")}</th>
                <th className="w-28 border border-black px-1">{t("columns.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(([number, key, rate]) => (
                <tr key={number}>
                  <td className="border border-black px-1 text-center">{number}</td>
                  <td className="border border-black px-1 italic">{t(`lines.${key}`)}</td>
                  <td className="border border-black px-1 text-right">{rate}</td>
                  <td className="border border-black px-1" />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="flex flex-col gap-1">
        <h2 className="text-center text-xs font-bold">{t("part4")}</h2>
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {PART_4.map(([number, key]) => (
              <tr key={number}>
                <td className="w-12 border border-black px-1 text-center">{number}</td>
                <td className="border border-black px-1 italic">{t(`lines.${key}`)}</td>
                <td className="w-28 border border-black px-1" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-center text-xs font-bold">{t("part5")}</h2>
        <p className="border border-black p-2 text-[11px]">{t("statement")}</p>
        <div className="grid grid-cols-[1fr_10rem] gap-1">
          <Box label={t("fields.signature")} className="min-h-12" />
          <Box label={t("fields.date")} />
        </div>
      </section>
    </div>
  );
}
