import ExcelJS from "exceljs";
import { getTranslations } from "next-intl/server";
import { getMemberAccess } from "@/lib/auth/access";
import { getCurrentMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import { parseReportParams } from "@/modules/reports/params";
import { loadReport, type ReportData } from "@/modules/reports/report";

// Excel export of one report tab (D-043): the same figures as /reports,
// one sheet per table. Hours as decimal hours, money in KM, reports.read.

type Cell = string | number | null;
type Sheet = { name: string; header: string[]; rows: Cell[][] };

const hours = (seconds: number) => Math.round(seconds / 360) / 10;
const n = (value: string | null) => (value === null ? null : Number(value));

async function sheets(data: ReportData): Promise<Sheet[]> {
  const t = await getTranslations("reports");
  switch (data.tab) {
    case "production":
      return [
        {
          name: t("tabs.production"),
          header: [
            "",
            t("production.good"),
            t("production.scrap"),
            t("production.scrapRate"),
            t("production.time"),
            t("production.planned"),
            t("production.efficiency"),
            t("production.goodPerHour"),
          ],
          rows: data.rows.map((row) => [
            row.label || (data.group === "day" ? "" : t(`missing.${data.group}`)),
            n(row.good),
            n(row.scrap),
            n(row.scrapRate),
            hours(row.seconds),
            hours(row.plannedSeconds),
            row.efficiency,
            row.goodPerHour,
          ]),
        },
        {
          name: t("production.scrapByReason"),
          header: [t("production.reason"), t("production.scrap")],
          rows: data.scrap.map((row) => [row.reason || t("noReason"), n(row.scrap)]),
        },
        {
          name: t("production.downtimeByReason"),
          header: [t("production.reason"), t("production.totalTime")],
          rows: data.downtime.map((row) => [row.reason, hours(row.seconds)]),
        },
      ];
    case "machines":
      return [
        {
          name: t("tabs.machines"),
          header: [
            t("machines.machine"),
            t("machines.capacity"),
            t("machines.run"),
            t("machines.downtime"),
            t("machines.idle"),
            t("machines.utilization"),
            t("machines.toolChanges"),
          ],
          rows: data.machines.map((row) => [
            row.label,
            hours(row.capacitySeconds),
            hours(row.runSeconds),
            hours(row.downtimeSeconds),
            hours(row.idleSeconds),
            row.utilization,
            row.toolChanges,
          ]),
        },
        {
          name: t("production.downtimeByReason"),
          header: [t("production.reason"), t("production.totalTime")],
          rows: data.downtime.map((row) => [row.reason, hours(row.seconds)]),
        },
      ];
    case "orders":
      return [
        {
          name: t("tabs.orders"),
          header: [
            t("orders.order"),
            t("orders.customer"),
            t("orders.product"),
            t("orders.quantity"),
            t("orders.good"),
            t("orders.due"),
            t("orders.completedOn"),
            t("orders.late"),
            t("orders.plannedTime"),
            t("orders.runTime"),
          ],
          rows: data.rows.map((row) => [
            row.number,
            row.customer,
            `${row.part_number ?? ""} ${row.product ?? ""}`.trim(),
            n(row.quantity),
            n(row.good),
            row.due_date,
            row.completed_on,
            row.lateDays,
            hours(row.planned_seconds),
            hours(row.run_seconds),
          ]),
        },
      ];
    case "costs":
      return [
        {
          name: t("costs.title"),
          header: [
            t("orders.order"),
            t("orders.customer"),
            t("orders.good"),
            t("costs.material"),
            t("costs.machine"),
            t("costs.external"),
            t("costs.total"),
            t("costs.perPiece"),
          ],
          rows: data.rows.map((row) => [
            row.number,
            row.customer,
            n(row.good),
            Math.round(Number(row.material_cost) * 100) / 100,
            Math.round(Number(row.machine_cost) * 100) / 100,
            Math.round(Number(row.external_cost) * 100) / 100,
            Math.round(Number(row.totalCost) * 100) / 100,
            n(row.costPerPiece),
          ]),
        },
        {
          name: t("costs.materialTitle"),
          header: [t("costs.item"), t("costs.quantity"), t("costs.mass"), t("costs.value")],
          rows: data.material.map((row) => [
            row.label,
            n(row.quantity),
            n(row.massKg),
            Math.round(Number(row.value) * 100) / 100,
          ]),
        },
        {
          name: t("costs.stockTitle"),
          header: [t("costs.item"), t("costs.quantity"), t("costs.mass"), t("costs.value")],
          rows: data.stock.rows.map((row) => [
            row.label,
            n(row.quantity),
            n(row.massKg),
            Math.round(Number(row.value) * 100) / 100,
          ]),
        },
        {
          name: t("costs.toolsTitle"),
          header: [t("costs.tool"), t("costs.consumed"), t("costs.scrapped")],
          rows: data.tools.map((row) => [`${row.code} · ${row.name}`, row.consumed, row.scrapped]),
        },
      ];
  }
}

export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) return new Response(null, { status: 401 });
  const access = await getMemberAccess(member);
  if (!access.modules.has("production") || !access.permissions.has("reports.read")) {
    return new Response(null, { status: 403 });
  }
  const today = zonedDate(new Date(), member.organization.timezone);
  const url = new URL(request.url);
  const { filters, invalid } = parseReportParams(Object.fromEntries(url.searchParams), today);
  if (invalid) return new Response(null, { status: 400 });

  const data = await loadReport(member.organization.id, filters, today);
  const workbook = new ExcelJS.Workbook();
  for (const sheet of await sheets(data)) {
    // Excel sheet names: at most 31 characters, no []:*?/\ characters.
    const worksheet = workbook.addWorksheet(sheet.name.replace(/[[\]:*?/\\]/g, "-").slice(0, 31));
    worksheet.addRow(sheet.header).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow(row);
    worksheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 36 : 14;
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="izvjestaj-${filters.tab}-${filters.from}-${filters.to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
