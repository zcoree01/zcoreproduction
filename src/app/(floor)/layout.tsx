import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { requireMember } from "@/lib/auth/session";

// Shop-floor UI (mobile-first, large touch targets). Open to every member.
export default function FloorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<FloorFallback />}>
        <FloorShell>{children}</FloorShell>
      </Suspense>
    </div>
  );
}

async function FloorFallback() {
  const t = await getTranslations("common");
  return (
    <main className="px-4 py-6">
      <PageSkeleton label={t("loading")} />
    </main>
  );
}

async function FloorShell({ children }: { children: ReactNode }) {
  const member = await requireMember();
  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
        <span className="truncate text-base font-semibold">{member.organization.name}</span>
        <SignOutButton size="lg" />
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
