import { BuildingIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { countryName } from "@/lib/countries";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { zonedDate } from "@/lib/timezone";
import { listPlatformOrganizations } from "@/modules/platform/queries";
import { listPlatformSupportRequests } from "@/modules/support/queries";
import { ModuleEditor } from "./module-editor";
import { SupportEndedNotice } from "./support-ended-notice";
import { SupportControl } from "./support-control";

export default function PlatformPage({ searchParams }: PageProps<"/platform">) {
  return (
    <PageSuspense>
      <PlatformContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function PlatformContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const [t, format, access] = await Promise.all([
    getTranslations("platform"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const [all, support] = await Promise.all([
    listPlatformOrganizations(),
    listPlatformSupportRequests(),
  ]);
  // Active organizations first (newest first), archived ones at the end.
  const organizations = [...all].sort((a, b) => Number(a.archived) - Number(b.archived));

  return (
    <>
      {firstParam((await searchParams).support) === "ended" ? <SupportEndedNotice /> : null}
      <PageHeader title={t("organizationsTitle")} description={t("organizationsDescription")} />
      {organizations.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-4">
          {organizations.map((organization) => (
            <Card key={organization.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {organization.name}
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {organization.slug}
                  </span>
                  {organization.archived ? (
                    <Badge variant="secondary">{t("archived")}</Badge>
                  ) : null}
                  {organization.claimPending ? <Badge>{t("claimPending")}</Badge> : null}
                </CardTitle>
                <CardDescription>
                  {[
                    organization.company
                      ? `${organization.company.taxId} · ${[organization.company.city, countryName(organization.company.country)].filter(Boolean).join(", ")}`
                      : t("noCompany"),
                    t("members", { count: organization.memberCount }),
                    t("since", {
                      date: format.dateTime(new Date(organization.createdAt), {
                        dateStyle: "medium",
                      }),
                    }),
                  ].join(" · ")}
                </CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {organization.modules.map((module) => (
                  <ModuleEditor
                    key={module.key}
                    organizationId={organization.id}
                    module={module}
                    initialUntilDay={
                      module.activeUntil
                        ? zonedDate(new Date(module.activeUntil), "Europe/Sarajevo")
                        : ""
                    }
                  />
                ))}
                <SupportControl
                  organizationId={organization.id}
                  request={support.get(organization.id) ?? null}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
