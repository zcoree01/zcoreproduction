import { FactoryIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { ModeToggle } from "@/components/shared/mode-toggle";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { TextSizeMarker } from "@/components/shared/text-size-marker";
import { buttonVariants } from "@/components/ui/button";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/route-guard";
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
  // Also when rendered by a server-action redirect, which skips the proxy.
  if (member.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  const [groups, t] = await Promise.all([
    getNavigation(member, "floor"),
    getTranslations("profile"),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <TextSizeMarker size={member.preferences.textSize} />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FactoryIcon className="size-4" />
        </div>
        <span className="truncate text-base font-semibold">{member.organization.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <ModeToggle size="icon-lg" />
          <Link
            href="/floor/profile"
            aria-label={t("title")}
            className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
          >
            <UserRoundIcon />
          </Link>
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
