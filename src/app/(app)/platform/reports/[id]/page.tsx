import { ArrowLeftIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ErrorState } from "@/components/shared/error-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { getPlatformReport, type PlatformReportDetail } from "@/modules/platform/reports-queries";
import { z } from "zod";
import { ReportDetail } from "../report-detail";

export default function PlatformReportPage({ params }: PageProps<"/platform/reports/[id]">) {
  return (
    <PageSuspense>
      <PlatformReportContent params={params} />
    </PageSuspense>
  );
}

async function PlatformReportContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const [t, access, { id }] = await Promise.all([
    getTranslations("platformReports"),
    getMemberAccess(member),
    params,
  ]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  if (!z.uuid().safeParse(id).success) notFound();

  let report: PlatformReportDetail | null;
  try {
    report = await getPlatformReport(id);
  } catch (error) {
    console.error(error);
    return <ErrorState title={t("errorTitle")} />;
  }
  if (!report) notFound();

  return (
    <>
      <Link
        href="/platform/reports"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        {t("detail.back")}
      </Link>
      <PageHeader title={report.organization.name} description={t("detail.description")} />
      <ReportDetail
        report={report}
        canManage={access.permissions.has("platform.reports.manage")}
        canSchedule={
          access.permissions.has("platform.reports.manage") &&
          access.permissions.has("platform.support")
        }
      />
    </>
  );
}
