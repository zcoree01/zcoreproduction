import { ArrowLeftIcon, ClipboardXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { getStockCount, listStockItemOptions } from "@/modules/inventory/queries";
import { CountEntry } from "../count-entry";

export default function CountPage({ params }: PageProps<"/inventory/counts/[id]">) {
  return (
    <PageSuspense>
      <CountContent params={params} />
    </PageSuspense>
  );
}

async function CountContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("inventory"), getMemberAccess(member)]);
  if (!access.modules.has("inventory")) return <ModuleDisabled />;
  if (!access.permissions.has("inventory.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const { id } = await params;
  const countId = z.uuid().safeParse(id);
  const count = countId.success ? await getStockCount(organizationId, countId.data) : null;
  const back = (
    <Link
      href="/inventory/counts"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
    >
      <ArrowLeftIcon />
      {t("counts.back")}
    </Link>
  );
  if (!count) {
    return (
      <>
        {back}
        <EmptyState icon={<ClipboardXIcon />} title={t("counts.notFoundTitle")} />
      </>
    );
  }
  const canMove = access.permissions.has("inventory.move");
  const items =
    canMove && count.status === "open" ? await listStockItemOptions(organizationId) : [];

  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageHeader
        title={`${count.number} · ${t(`counts.status.${count.status}`)}`}
        description={count.location}
      />
      <CountEntry
        count={count}
        items={items}
        can={{ move: canMove, approve: access.permissions.has("inventory.adjust.approve") }}
      />
    </div>
  );
}
