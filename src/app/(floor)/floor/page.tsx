import { ClipboardListIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export default function FloorPage() {
  return (
    <PageSuspense>
      <FloorContent />
    </PageSuspense>
  );
}

async function FloorContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("floor"), getMemberAccess(member)]);
  const hasOperations =
    access.modules.has("production") &&
    (access.permissions.has("machines.status.update") || access.permissions.has("quality.inspect"));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {t("welcome", { name: member.fullName ?? member.username })}
      </h1>
      {hasOperations ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("operationsTitle")}
          description={t("operationsDescription")}
          action={
            <Link
              href="/floor/operations"
              className={cn(buttonVariants({ size: "lg" }), "h-12 px-6 text-base")}
            >
              {t("operationsOpen")}
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("noTasksTitle")}
          description={t("noTasksDescription")}
        />
      )}
    </div>
  );
}
