import { PrinterIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { headers } from "next/headers";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatLocalDateTime } from "@/lib/format";
import { requestHost, tenantUrl } from "@/lib/tenant/resolve";
import { utcToZonedLocal } from "@/lib/timezone";
import { listKioskCredentials, listKiosks } from "@/modules/attendance/kiosk-queries";
import { CredentialList } from "./credential-list";
import { KioskList } from "./kiosk-list";

// Kiosk tablets (activation codes, revoke) and the workers' kiosk
// credentials (PIN, badge) with printable QR badges (kiosk.manage).

export default function KioskSettingsPage() {
  return (
    <PageSuspense>
      <KioskSettingsContent />
    </PageSuspense>
  );
}

async function KioskSettingsContent() {
  const member = await requireMember();
  const [t, access, requestHeaders] = await Promise.all([
    getTranslations("kioskSettings"),
    getMemberAccess(member),
    headers(),
  ]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("kiosk.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const [kiosks, credentials] = await Promise.all([
    listKiosks(member.organization.id),
    listKioskCredentials(member.organization.id),
  ]);
  const kioskUrl = tenantUrl({
    host: requestHost(requestHeaders) ?? "",
    protocol: requestHeaders.get("x-forwarded-proto"),
    slug: member.organization.slug,
    path: "/kiosk",
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/settings/kiosk/badges" className={buttonVariants({ variant: "outline" })}>
            <PrinterIcon />
            {t("printBadges")}
          </Link>
        }
      />
      <KioskList
        kiosks={kiosks.map((kiosk) => ({
          ...kiosk,
          lastSeen: kiosk.lastSeenAt
            ? formatLocalDateTime(utcToZonedLocal(kiosk.lastSeenAt, member.organization.timezone))
            : null,
        }))}
        kioskUrl={kioskUrl}
      />
      <CredentialList credentials={credentials} />
    </>
  );
}
