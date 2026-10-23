import { FactoryIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { ModeToggle } from "@/components/shared/mode-toggle";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { requireMember } from "@/lib/auth/session";
import { getNavigation } from "@/lib/navigation/server";
import { BottomNav } from "./bottom-nav";

// Shop-floor UI (mobile-first, large touch targets). Open to every member.
export default function FloorLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<FloorFallback />}>
      <FloorShell>{children}</FloorShell>
    </Suspense>
  );
}

async function FloorFallback() {
  const t = await getTranslations("common");
  return (
    <div className="px-4 py-6">
      <PageSkeleton label={t("loading")} />
    </div>
  );
}

async function FloorShell({ children }: { children: ReactNode }) {
  const member = await requireMember();
  const groups = await getNavigation(member, "floor");

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FactoryIcon className="size-4" />
        </div>
        <span className="truncate text-base font-semibold">{member.organization.name}</span>
        <div className="ml-auto">
          <ModeToggle size="icon-lg" />
        </div>
      </header>
      {/* pb-24 keeps content clear of the fixed bottom navigation. */}
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-24">
        {children}
      </main>
      <BottomNav items={groups.flatMap((group) => group.items)} />
    </div>
  );
}
