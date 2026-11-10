import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ErrorState } from "@/components/shared/error-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import {
  listPlatformReports,
  type PlatformReportRow,
  type PlatformSupportRow,
  listPlatformSupportRows,
  listReportOrganizations,
} from "@/modules/platform/reports-queries";
import { REPORTS_TABS, reportsFilterSchema, reportsTab } from "@/modules/platform/reports-schemas";
import { ReportsTable } from "./reports-table";
import { SupportRequestsTable } from "./support-requests-table";

export default function PlatformReportsPage({ searchParams }: PageProps<"/platform/reports">) {
  return (
    <PageSuspense>
      <PlatformReportsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

/** Problem reports of all firms and the list of support access requests. */
async function PlatformReportsContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const [t, access, params] = await Promise.all([
    getTranslations("platformReports"),
    getMemberAccess(member),
    searchParams,
  ]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const tab = reportsTab(firstParam(params.tab));
  const filter = reportsFilterSchema.parse({
    status: firstParam(params.status),
    category: firstParam(params.category),
    org: firstParam(params.org),
  });

  type Loaded =
    | { kind: "support"; rows: PlatformSupportRow[]; now: number }
    | {
        kind: "reports";
        rows: PlatformReportRow[];
        organizations: { id: string; name: string }[];
      }
    | { kind: "error" };
  let loaded: Loaded;
  try {
    if (tab === "support") {
      loaded = { kind: "support", ...(await listPlatformSupportRows()) };
    } else {
      const [rows, organizations] = await Promise.all([
        listPlatformReports(filter),
        listReportOrganizations(),
      ]);
      loaded = { kind: "reports", rows, organizations };
    }
  } catch (error) {
    console.error(error);
    loaded = { kind: "error" };
  }
  const content =
    loaded.kind === "support" ? (
      <SupportRequestsTable rows={loaded.rows} now={loaded.now} />
    ) : loaded.kind === "reports" ? (
      <ReportsTable rows={loaded.rows} filter={filter} organizations={loaded.organizations} />
    ) : (
      <ErrorState title={t("errorTitle")} />
    );

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t("title")}>
        {REPORTS_TABS.map((key) => (
          <Link
            key={key}
            role="tab"
            aria-selected={tab === key}
            href={key === "reports" ? "/platform/reports" : `/platform/reports?tab=${key}`}
            className={cn(
              buttonVariants({ variant: tab === key ? "default" : "outline", size: "sm" }),
            )}
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </div>
      {content}
    </>
  );
}
