import { CogIcon, UserXIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listMyMachines } from "@/modules/machines/queries";
import { FloorMachineCard } from "./floor-machine-card";

export default function FloorMachinesPage() {
  return (
    <PageSuspense>
      <FloorMachinesContent />
    </PageSuspense>
  );
}

async function FloorMachinesContent() {
  const member = await requireMember();
  const [t, format, access] = await Promise.all([
    getTranslations("floorMachines"),
    getFormatter(),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("machines.status.update")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const mine = await listMyMachines(member.organization.id, member.userId);

  const header = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
    </div>
  );

  if (!mine.employee) {
    return (
      <>
        {header}
        <EmptyState
          icon={<UserXIcon />}
          title={t("noEmployeeTitle")}
          description={t("noEmployeeDescription")}
        />
      </>
    );
  }
  if (!mine.employee.active) {
    return (
      <>
        {header}
        <EmptyState
          icon={<UserXIcon />}
          title={t("inactiveTitle")}
          description={t("inactiveDescription")}
        />
      </>
    );
  }

  return (
    <>
      {header}
      {mine.machines.length === 0 ? (
        <EmptyState
          icon={<CogIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {mine.machines.map((machine) => (
            <li key={machine.id}>
              <FloorMachineCard
                machine={{
                  id: machine.id,
                  code: machine.code,
                  name: machine.name,
                  location: machine.location?.name ?? null,
                  status: machine.status,
                }}
                since={t("since", {
                  time: format.dateTime(new Date(machine.statusChangedAt), {
                    timeZone: member.organization.timezone,
                    day: "numeric",
                    month: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
