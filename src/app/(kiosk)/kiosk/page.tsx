import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { getKioskSession } from "@/modules/attendance/kiosk-device";
import { ActivationForm } from "./activation-form";
import { InstallApp } from "./install-app";
import { KioskScreen } from "./kiosk-screen";

// The attendance kiosk: a shared tablet at the entrance without a user
// login. Not activated yet → the one-time activation code; activated → badge
// scan (camera QR, NFC, keyboard scanner) or name + PIN (D-029). Served on
// kiosk.zcore.ba for every company, installable as an app (D-048).

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("kiosk");
  return {
    title: t("appName"),
    manifest: "/kiosk/manifest.webmanifest",
    appleWebApp: { capable: true, title: t("appName") },
  };
}

export default function KioskPage() {
  return (
    <Suspense fallback={<PageSkeleton label="" />}>
      <KioskContent />
    </Suspense>
  );
}

async function KioskContent() {
  const [session, t] = await Promise.all([getKioskSession(), getTranslations("kiosk")]);
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-background p-4 sm:p-8">
      {session ? (
        <KioskScreen
          kioskName={session.kioskName}
          organizationName={session.organizationName}
          timeZone={session.timeZone}
          employees={session.employees}
        />
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6">
          <div className="flex flex-col gap-2 text-center">
            <h1 className="text-3xl font-semibold">{t("activateTitle")}</h1>
            <p className="text-muted-foreground">{t("activateDescription")}</p>
          </div>
          <ActivationForm />
          <InstallApp />
        </div>
      )}
    </main>
  );
}
