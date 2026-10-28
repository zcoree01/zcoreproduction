import { ClockIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChangeRequestList } from "@/components/shared/company/change-request-list";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import {
  getOrganizationProfile,
  listChangeRequestsToDecide,
  listMyChangeRequests,
} from "@/modules/companies/queries";
import { companyToFormValues, EMPTY_COMPANY_PROFILE } from "@/modules/companies/schemas";
import { CompanyProfileForm } from "./company-profile-form";

export default function CompanySettingsPage() {
  return (
    <PageSuspense>
      <CompanySettingsContent />
    </PageSuspense>
  );
}

const STATUS_TONES: Record<string, StatusTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

async function CompanySettingsContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, format, access] = await Promise.all([
    getTranslations("companySettings"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  // The Zcore organization itself has no company data or support access (D-028).
  if (access.modules.has("platform")) {
    return <PermissionDenied description={t("notForPlatform")} />;
  }
  if (!access.permissions.has("org.settings.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const [profile, toDecide, mine] = await Promise.all([
    getOrganizationProfile(organizationId),
    listChangeRequestsToDecide(organizationId),
    listMyChangeRequests(organizationId),
  ]);
  const initial =
    profile.status === "none"
      ? { ...EMPTY_COMPANY_PROFILE, name: member.organization.name }
      : companyToFormValues(profile.company);
  // Own proposals on the platform page are listed there; here only update requests.
  const incoming = toDecide.filter((request) => request.kind === "update");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {profile.status === "claim_pending" ? (
        <Alert className="max-w-3xl">
          <ClockIcon />
          <AlertTitle>{t("claimPendingTitle")}</AlertTitle>
          <AlertDescription>
            {t("claimPendingDescription", {
              date: format.dateTime(new Date(profile.requestedAt), { dateStyle: "medium" }),
            })}
          </AlertDescription>
        </Alert>
      ) : profile.status === "none" ? (
        <Alert className="max-w-3xl">
          <AlertTitle>{t("noneTitle")}</AlertTitle>
          <AlertDescription>{t("noneDescription")}</AlertDescription>
        </Alert>
      ) : null}

      <CompanyProfileForm initial={initial} lockTaxId={profile.status === "owned"} />

      {profile.status === "owned" ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>{t("incomingTitle", { count: incoming.length })}</CardTitle>
            <CardDescription>{t("incomingDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {incoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("incomingEmpty")}</p>
            ) : (
              <ChangeRequestList requests={incoming} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {mine.length > 0 ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>{t("sentTitle")}</CardTitle>
            <CardDescription>{t("sentDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {mine.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{request.companyName}</span>
                  <span className="text-muted-foreground">
                    {t(`sentKind.${request.kind}`)} ·{" "}
                    {format.dateTime(new Date(request.createdAt), { dateStyle: "medium" })}
                  </span>
                  <StatusBadge tone={STATUS_TONES[request.status] ?? "neutral"} className="ml-auto">
                    {t(`sentStatus.${request.status}`)}
                  </StatusBadge>
                  {request.decisionNote ? (
                    <p className="w-full text-muted-foreground">{request.decisionNote}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
