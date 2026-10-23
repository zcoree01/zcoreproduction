import { ClipboardListIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { requireMember } from "@/lib/auth/session";

export default function FloorPage() {
  return (
    <PageSuspense>
      <FloorContent />
    </PageSuspense>
  );
}

async function FloorContent() {
  const member = await requireMember();
  const t = await getTranslations("floor");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {t("welcome", { name: member.fullName ?? member.username })}
      </h1>
      <EmptyState
        icon={<ClipboardListIcon />}
        title={t("noTasksTitle")}
        description={t("noTasksDescription")}
      />
    </div>
  );
}
