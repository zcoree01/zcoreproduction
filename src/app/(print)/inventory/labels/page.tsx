import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { Suspense } from "react";
import { z } from "zod";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import { requestHost, tenantUrl } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import {
  LABEL_SIZES,
  locationLabelPath,
  lotLabelPath,
  parseLabelSize,
  type LabelSize,
} from "@/modules/inventory/label-rules";
import { getStockItemDetail, listStockLocations } from "@/modules/inventory/queries";

// Printable QR labels (D-033): pieces of an item per lot and size (incl.
// remnants), or locations. The QR is a link into the app, so a phone camera
// opens the right warehouse screen as well as the in-app scanner.

type Label = { key: string; title: string; lines: string[]; svg: string };

const SIZE_CLASS: Record<LabelSize, { grid: string; label: string; qr: string; text: string }> = {
  "50x30": {
    grid: "flex flex-wrap gap-[2mm]",
    label: "h-[30mm] w-[50mm] p-[2mm] gap-[2mm]",
    qr: "size-[25mm]",
    text: "text-[7pt]",
  },
  "70x40": {
    grid: "flex flex-wrap gap-[2mm]",
    label: "h-[40mm] w-[70mm] p-[3mm] gap-[3mm]",
    qr: "size-[33mm]",
    text: "text-[9pt]",
  },
  a4: {
    grid: "grid grid-cols-3 gap-0",
    label: "h-[37mm] w-[70mm] p-[3mm] gap-[3mm]",
    qr: "size-[30mm]",
    text: "text-[8pt]",
  },
};

export default function LabelsPage({ searchParams }: PageProps<"/inventory/labels">) {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <LabelsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LabelsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tStock, access, requestHeaders, params] = await Promise.all([
    getTranslations("inventory.labels"),
    getTranslations("inventory"),
    getMemberAccess(member),
    headers(),
    searchParams,
  ]);
  if (!access.modules.has("inventory") || !access.permissions.has("inventory.read")) {
    return <p className="p-8">{t("denied")}</p>;
  }

  const size = parseLabelSize(params.size);
  const itemId = z.uuid().safeParse(params.item);
  const host = requestHost(requestHeaders) ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null;
  const qr = (path: string) =>
    QRCode.toString(tenantUrl({ host, protocol, slug: member.organization.slug, path }), {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
    });

  let labels: Label[] = [];
  let back = "/inventory/locations";
  if (itemId.success) {
    back = `/inventory/${itemId.data}`;
    const detail = await getStockItemDetail(organizationId, itemId.data);
    labels = await Promise.all(
      (detail?.balances ?? []).map(async (b) => ({
        key: `${b.lotId}:${b.locationId}:${b.length}:${b.width}`,
        title: `${detail?.item.code ?? ""} · ${detail?.item.name ?? ""}`,
        lines: [
          t("lot", { lot: b.lotNumber }),
          b.heatNumber ? t("heat", { heat: b.heatNumber }) : "",
          b.length
            ? b.width
              ? tStock("sheetSize", {
                  length: formatDecimal(b.length),
                  width: formatDecimal(b.width),
                })
              : tStock("barSize", { length: formatDecimal(b.length) })
            : "",
          b.ownerCustomer ?? "",
          b.location,
        ].filter(Boolean),
        svg: await qr(lotLabelPath(b.lotId)),
      })),
    );
  } else {
    const locations = (await listStockLocations(organizationId)).filter((l) => !l.archived);
    labels = await Promise.all(
      locations.map(async (l) => ({
        key: l.id,
        title: l.code,
        lines: [l.name, l.machineName ?? ""].filter(Boolean),
        svg: await qr(locationLabelPath(l.id)),
      })),
    );
  }

  const style = SIZE_CLASS[size];
  const sizeHref = (value: LabelSize) => {
    const query = new URLSearchParams();
    if (itemId.success) query.set("item", itemId.data);
    query.set("size", value);
    return `/inventory/labels?${query.toString()}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4 p-6 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={back} className={buttonVariants({ variant: "outline" })}>
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm">{t("size")}:</span>
          {LABEL_SIZES.map((value) => (
            <Link
              key={value}
              href={sizeHref(value)}
              aria-current={value === size ? "page" : undefined}
              className={buttonVariants({
                variant: value === size ? "default" : "outline",
                size: "sm",
              })}
            >
              {t(`sizes.${value}`)}
            </Link>
          ))}
        </div>
        <PrintButton label={t("print")} />
      </div>
      <h1 className="text-lg font-semibold print:hidden">
        {itemId.success ? t("item") : t("locations")}
      </h1>
      {labels.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className={style.grid}>
          {labels.map((label) => (
            <div
              key={label.key}
              data-testid="stock-label"
              className={cn(
                "flex break-inside-avoid items-center overflow-hidden border border-black",
                style.label,
              )}
            >
              <div
                className={cn("shrink-0 [&_svg]:size-full", style.qr)}
                // QR SVG generated on the server from our own link.
                dangerouslySetInnerHTML={{ __html: label.svg }}
              />
              <div className={cn("flex min-w-0 flex-col leading-tight", style.text)}>
                <span className="font-semibold">{label.title}</span>
                {label.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
