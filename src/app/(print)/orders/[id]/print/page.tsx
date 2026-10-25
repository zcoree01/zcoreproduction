import { getFormatter, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { Suspense, type ReactNode } from "react";
import { z } from "zod";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import { requestHost, tenantUrl } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import {
  getOrder,
  getOrderSettings,
  listOrderAttachments,
  listOrderOperations,
} from "@/modules/production-orders/queries";
import { barPlan } from "@/modules/production-orders/rules";
import { isWholeUnit } from "@/modules/production-orders/schemas";
import { getProductionSettings } from "@/modules/products/queries";
import { resolveCycleUnit, secondsToUnit, splitDuration } from "@/modules/products/rules";
import { PrintButton } from "./print-button";

// A4 production order with one QR code for the order. The QR opens the order
// on the worker's phone (/floor/orders/<id>), which leads to the operation of
// that worker's machine; production reporting will start from there.

export default function PrintOrderPage({ params }: PageProps<"/orders/[id]/print">) {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <PrintContent params={params} />
    </Suspense>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border border-black/40 px-2 py-1">
      <span className="text-[9px] tracking-wide text-black/60 uppercase">{label}</span>
      <span className="text-[12px] font-medium">{children || "—"}</span>
    </div>
  );
}

async function PrintContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tStatus, tUnits, tPriority, format, access, requestHeaders] = await Promise.all([
    getTranslations("orders.print"),
    getTranslations("orderStatus"),
    getTranslations("productUnits"),
    getTranslations("priority"),
    getFormatter(),
    getMemberAccess(member),
    headers(),
  ]);
  if (!access.modules.has("production") || !access.permissions.has("orders.read")) {
    return <p className="p-8">{t("denied")}</p>;
  }

  const { id } = await params;
  const orderId = z.uuid().safeParse(id);
  const order = orderId.success ? await getOrder(organizationId, orderId.data) : null;
  if (!order) return <p className="p-8">{t("notFound")}</p>;

  const [operations, attachments, productionSettings, settings] = await Promise.all([
    listOrderOperations(organizationId, order.id),
    listOrderAttachments(organizationId, order.id),
    getProductionSettings(organizationId),
    getOrderSettings(organizationId),
  ]);
  const active = operations.filter((op) => !op.archived);
  const host = requestHost(requestHeaders) ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null;
  const qrCode = await QRCode.toString(
    tenantUrl({
      host,
      protocol,
      slug: member.organization.slug,
      path: `/floor/orders/${order.id}`,
    }),
    { type: "svg", margin: 0, errorCorrectionLevel: "M" },
  );

  const day = (value: string | null) =>
    value
      ? format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })
      : "";
  const duration = (seconds: string) => {
    const { hours, minutes } = splitDuration(seconds);
    return t("duration", { hours, minutes });
  };
  const plan = barPlan({
    barLength: order.barLength,
    remnant: order.barRemnant,
    pieceLength: order.pieceLength,
    kerf: order.kerf,
    quantity: order.quantity,
    wholePieces: isWholeUnit(order.unit),
  });
  const drawings = attachments.filter((a) => a.replacedAt === null && a.kind === "main_drawing");
  const printedAt = format.dateTime(new Date(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: member.organization.timezone,
  });

  return (
    <>
      <style>{`@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } }`}</style>
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3 print:hidden">
        <Link href={`/orders/${order.id}`} className={cn(buttonVariants({ variant: "outline" }))}>
          {t("back")}
        </Link>
        <PrintButton />
      </div>
      <main className="mx-auto w-full max-w-[186mm] px-4 py-6 font-sans text-black print:p-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
          <div>
            <p className="text-[11px] text-black/70">{member.organization.name}</p>
            <h1 className="text-xl font-bold tracking-wide uppercase">{t("title")}</h1>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <p className="font-mono text-2xl font-bold">{order.orderNumber}</p>
              <p className="text-[11px] text-black/70">
                {tStatus(order.status)} · {t("printedAt", { time: printedAt })}
              </p>
              <p className="mt-1 max-w-[60mm] text-[10px] text-black/60">{t("qrHint")}</p>
            </div>
            <div
              className="size-[24mm] shrink-0 [&>svg]:size-full"
              role="img"
              aria-label={t("qrLabel", { number: order.orderNumber })}
              dangerouslySetInnerHTML={{ __html: qrCode }}
            />
          </div>
        </header>

        <section className="mt-3 grid grid-cols-4">
          <Cell label={t("customer")}>{order.customer?.name}</Cell>
          <Cell label={t("partNumber")}>
            <span className="font-mono">{order.product?.partNumber}</span>
          </Cell>
          <Cell label={t("product")}>{order.product?.name}</Cell>
          <Cell label={t("drawing")}>
            {[order.drawingNumber, t("revision", { revision: order.revision ?? "—" })]
              .filter(Boolean)
              .join(" · ")}
          </Cell>
          <Cell label={t("quantity")}>
            {formatDecimal(order.quantity)} {tUnits(order.unit)}
          </Cell>
          <Cell label={t("dueDate")}>{day(order.dueDate)}</Cell>
          <Cell label={t("priority")}>
            {order.effectivePriority} –{" "}
            {tPriority(`levels.${order.effectivePriority}` as "levels.1")}
          </Cell>
          <Cell label={t("planned")}>
            {order.plannedStart || order.plannedEnd
              ? `${day(order.plannedStart)} – ${day(order.plannedEnd)}`
              : ""}
          </Cell>
          <Cell label={t("material")}>{order.material}</Cell>
          <Cell label={t("piece")}>
            {order.pieceLength
              ? `${formatDecimal(order.pieceLength)} mm${order.kerf ? ` + ${formatDecimal(order.kerf)} mm` : ""}`
              : ""}
          </Cell>
          <Cell label={t("bar")}>
            {plan && order.barLength
              ? t("barValue", {
                  bar: formatDecimal(order.barLength),
                  pieces: plan.piecesPerBar,
                  bars: plan.barsNeeded ?? "—",
                })
              : ""}
          </Cell>
          <Cell label={t("plannedTime")}>{duration(order.plannedSeconds)}</Cell>
        </section>
        {drawings.length > 0 ? (
          <p className="mt-1 text-[11px]">
            {t("drawings")}: {drawings.map((d) => d.title ?? d.fileName).join(", ")}
          </p>
        ) : null}
        {order.notes ? (
          <p className="mt-1 text-[11px] whitespace-pre-line">
            <span className="font-semibold">{t("notes")}:</span> {order.notes}
          </p>
        ) : null}

        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-black/5">
              <th className="border border-black/50 px-1 py-1 text-left">#</th>
              <th className="border border-black/50 px-1 py-1 text-left">{t("operation")}</th>
              <th className="border border-black/50 px-1 py-1 text-left">{t("machine")}</th>
              <th className="border border-black/50 px-1 py-1 text-left">{t("times")}</th>
              <th className="border border-black/50 px-1 py-1 text-right">{t("plannedTime")}</th>
              <th className="border border-black/50 px-1 py-1 text-center">{t("good")}</th>
              <th className="border border-black/50 px-1 py-1 text-center">{t("scrap")}</th>
              <th className="border border-black/50 px-1 py-1 text-left">{t("signature")}</th>
            </tr>
          </thead>
          <tbody>
            {active.map((op, index) => {
              const unit = resolveCycleUnit(
                op.machine?.cycleTimeUnit ?? null,
                productionSettings.cycleTimeUnit,
              );
              return (
                <tr key={op.id} className="break-inside-avoid">
                  <td className="border border-black/50 px-1 py-1 align-top tabular-nums">
                    {index + 1}
                  </td>
                  <td className="border border-black/50 px-1 py-1 align-top">
                    <span className="font-mono font-bold">{op.type.code}</span> {op.type.name}
                    {op.description ? (
                      <span className="block text-black/70">{op.description}</span>
                    ) : null}
                    {op.notes ? (
                      <span className="block text-[10px] text-black/70 italic">{op.notes}</span>
                    ) : null}
                  </td>
                  <td className="border border-black/50 px-1 py-1 align-top">
                    {op.type.isExternal
                      ? op.externalCompany
                      : op.machine
                        ? `${op.machine.code}`
                        : (op.machineType?.name ?? "")}
                    {op.workers.length > 0 ? (
                      <span className="block text-black/70">
                        {op.workers.map((w) => w.name).join(", ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="border border-black/50 px-1 py-1 align-top tabular-nums">
                    {op.setupTimeMin || op.cycleTimeS
                      ? t("setupCycle", {
                          setup: formatDecimal(op.setupTimeMin ?? "0"),
                          cycle: op.cycleTimeS
                            ? `${formatDecimal(secondsToUnit(op.cycleTimeS, unit))} ${unit}`
                            : "—",
                        })
                      : ""}
                  </td>
                  <td className="border border-black/50 px-1 py-1 text-right align-top tabular-nums">
                    {op.type.isExternal || op.plannedSeconds === "0"
                      ? ""
                      : duration(op.plannedSeconds)}
                  </td>
                  <td className="w-[14mm] border border-black/50" />
                  <td className="w-[14mm] border border-black/50" />
                  <td className="w-[30mm] border border-black/50" />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-black/60">
          {settings.priorityMode === "automatic" && order.priority === null
            ? ` ${t("priorityAutomatic")}`
            : ""}
        </p>

        <footer className="mt-10 grid break-inside-avoid grid-cols-3 gap-8 text-[11px]">
          {(["issuedBy", "approvedBy", "inspectedBy"] as const).map((role) => (
            <div key={role} className="flex flex-col gap-1">
              <div className="h-10 border-b border-black" />
              <span>{t(role)}</span>
              <span className="text-black/60">{t("signatureDate")}</span>
            </div>
          ))}
        </footer>
      </main>
    </>
  );
}
