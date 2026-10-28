import { getTranslations } from "next-intl/server";
import Link from "next/link";
import QRCode from "qrcode";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { PrintButton } from "@/components/shared/print-button";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { badgePayload } from "@/modules/attendance/kiosk-rules";
import { listKioskCredentials } from "@/modules/attendance/kiosk-queries";

// Printable kiosk badges (credit-card size, 8 per A4): name, number and a QR
// code with the badge token. The same text can be written to an NFC tag.

export default function BadgesPage() {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <BadgesContent />
    </Suspense>
  );
}

async function BadgesContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([
    getTranslations("kioskSettings"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("attendance") || !access.permissions.has("kiosk.manage")) {
    return <p className="p-8">{t("deniedDescription")}</p>;
  }
  const credentials = (await listKioskCredentials(member.organization.id)).filter(
    (row) => row.badgeToken !== null,
  );
  const badges = await Promise.all(
    credentials.map(async (row) => ({
      ...row,
      svg: await QRCode.toString(badgePayload(row.badgeToken ?? ""), {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
      }),
    })),
  );

  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4 p-6 print:p-0">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href="/settings/kiosk" className={buttonVariants({ variant: "outline" })}>
          {t("backToKiosk")}
        </Link>
        <PrintButton label={t("print")} />
      </div>
      {badges.length === 0 ? (
        <p>{t("noBadges")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-[6mm]">
          {badges.map((badge) => (
            <div
              key={badge.employeeId}
              className="flex h-[54mm] w-[85.6mm] break-inside-avoid items-center gap-3 rounded-lg border border-black p-3"
              data-testid="badge"
            >
              <div
                className="size-[38mm] shrink-0 [&_svg]:size-full"
                // QR SVG generated on the server from our own token.
                dangerouslySetInnerHTML={{ __html: badge.svg }}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[10px] text-black/60 uppercase">
                  {member.organization.name}
                </span>
                <span className="text-lg leading-tight font-semibold">{badge.name}</span>
                <span className="text-sm">#{badge.number}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
