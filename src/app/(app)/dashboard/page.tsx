import { LayoutGridIcon, Settings2Icon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { getRoleLayout } from "@/modules/dashboard/queries";
import { visibleWidgets } from "@/modules/dashboard/widgets";
import { DashboardGrid } from "./widgets";

export default function DashboardPage() {
  return (
    <PageSuspense>
      <DashboardContent />
    </PageSuspense>
  );
}

async function DashboardContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("dashboard"), getMemberAccess(member)]);
  // The Zcore organization has no production dashboard; its home is the platform.
  if (access.modules.has("platform")) redirect("/platform");
  const layout = member.role.archived
    ? { widgets: [], custom: false }
    : await getRoleLayout(organizationId, member.role);
  const widgets = visibleWidgets(layout.widgets, access);
  const canEdit = access.permissions.has("dashboard.manage");

  return (
    <>
      <PageHeader
        title={t("welcome", { name: member.fullName ?? member.username })}
        description={member.organization.name}
        actions={
          canEdit ? (
            <Link href="/dashboard/edit" className={buttonVariants({ variant: "outline" })}>
              <Settings2Icon />
              {t("edit")}
            </Link>
          ) : null
        }
      />
      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutGridIcon />}
          title={t("emptyTitle")}
          description={canEdit ? t("emptyDescriptionAdmin") : t("emptyDescription")}
        />
      ) : (
        <DashboardGrid
          widgets={widgets}
          context={{ organizationId, timeZone: member.organization.timezone }}
        />
      )}
    </>
  );
}
