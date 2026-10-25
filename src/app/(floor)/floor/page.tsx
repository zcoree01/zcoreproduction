import { ClipboardListIcon, InboxIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageSuspense } from "@/components/shared/page-suspense";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { listMyMachines } from "@/modules/machines/queries";
import { getAllMyFloorOperations } from "@/modules/production-orders/floor";
import { FloorOperationCard } from "./operation-card";

export default function FloorPage() {
  return (
    <PageSuspense>
      <FloorContent />
    </PageSuspense>
  );
}

// Home of a worker: the operations whose work has reached their machines now.
async function FloorContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("floor"), getMemberAccess(member)]);
  const hasOperations =
    access.modules.has("production") &&
    (access.permissions.has("machines.status.update") || access.permissions.has("quality.inspect"));

  const welcome = (
    <h1 className="text-2xl font-semibold">
      {t("welcome", { name: member.fullName ?? member.username })}
    </h1>
  );
  if (!hasOperations) {
    return (
      <div className="flex flex-col gap-6">
        {welcome}
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("noTasksTitle")}
          description={t("noTasksDescription")}
        />
      </div>
    );
  }

  const mine = await listMyMachines(member.organization.id, member.userId);
  const arrived =
    mine.employee && mine.employee.active
      ? (
          await getAllMyFloorOperations(
            member.organization.id,
            mine.machines.filter((machine) => !machine.archived).map((machine) => machine.id),
          )
        ).filter((item) => item.arrived)
      : [];
  const allOrders = (
    <Link
      href="/floor/operations"
      className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 px-6 text-base")}
    >
      {t("operationsOpen")}
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      {welcome}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("arrivedTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("arrivedDescription")}</p>
      </div>
      {arrived.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title={t("arrivedEmptyTitle")}
          description={t("arrivedEmptyDescription")}
          action={allOrders}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {arrived.map((item) => (
              <li key={item.operationId}>
                <FloorOperationCard item={item} />
              </li>
            ))}
          </ul>
          {allOrders}
        </>
      )}
    </div>
  );
}
