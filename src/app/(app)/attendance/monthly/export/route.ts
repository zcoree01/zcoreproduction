import ExcelJS from "exceljs";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { hasPermission } from "@/lib/auth/require-permission";
import { getCurrentMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import { ABSENCE_KINDS } from "@/modules/attendance/absence-schemas";
import { getMonthOverview } from "@/modules/attendance/month-overview";

// Payroll export of the monthly overview: one row per employee with hours
// (decimal hours), absence days and net pay (only with payroll.read).
// CSV uses ";" and a UTF-8 BOM so Excel opens it with Bosnian letters.

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  format: z.enum(["csv", "xlsx"]),
});

function hours(minutes: number): number {
  return Math.round(minutes / 6) / 10;
}

export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    month: url.searchParams.get("month"),
    format: url.searchParams.get("format"),
  });
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  if (!(await hasPermission(member.organization.id, "attendance.read"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const now = new Date();
  const timeZone = member.organization.timezone;
  const overview = await getMonthOverview(
    member.organization.id,
    parsed.data.month,
    timeZone,
    zonedDate(now, timeZone),
    now,
  );
  if (!overview) return new Response("Forbidden", { status: 403 });
  const t = await getTranslations("monthly");

  const header = [
    t("columns.number"),
    t("columns.employee"),
    t("columns.days"),
    t("export.worked"),
    t("export.regular"),
    t("export.overtime"),
    t("export.night"),
    t("export.weekend"),
    t("export.holiday"),
    ...ABSENCE_KINDS.map((kind) => t(`export.absence.${kind}`)),
    ...(overview.withPay ? [t("export.pay")] : []),
  ];
  const rows = overview.rows
    .filter((row) => row.totals.workedMin > 0 || Object.keys(row.absenceDays).length > 0)
    .map((row) => [
      row.employee.number,
      row.employee.name,
      row.totals.days,
      hours(row.totals.workedMin),
      hours(row.totals.regularMin),
      hours(row.totals.overtimeMin),
      hours(row.totals.nightMin),
      hours(row.totals.weekendMin),
      hours(row.totals.holidayMin),
      ...ABSENCE_KINDS.map((kind) => row.absenceDays[kind] ?? 0),
      ...(overview.withPay ? [row.totals.pay ?? ""] : []),
    ]);
  const fileName = `radno-vrijeme-${parsed.data.month}`;

  if (parsed.data.format === "csv") {
    const escape = (value: string | number) => {
      const text = typeof value === "number" ? String(value).replace(".", ",") : value;
      return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const body = [header, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
    return new Response(`﻿${body}\r\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Zcore Production";
  const sheet = workbook.addWorksheet(t("export.sheet", { month: parsed.data.month }));
  sheet.addRow([
    t("export.title", { month: parsed.data.month, organization: member.organization.name }),
  ]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      row.map((value, index) =>
        overview.withPay && index === row.length - 1 && value !== "" ? Number(value) : value,
      ),
    );
  }
  sheet.columns.forEach((column, index) => {
    column.width = index === 1 ? 28 : 14;
  });
  if (overview.withPay) sheet.getColumn(header.length).numFmt = "#,##0.00";
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
