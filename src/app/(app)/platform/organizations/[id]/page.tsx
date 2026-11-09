import { ArrowLeftIcon, BuildingIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import type { PermissionKey } from "@/lib/auth/permissions";
import { requireMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { getOrganizationBilling, listBillingPackages } from "@/modules/platform/billing-queries";
import { listPlatformSupportRequests } from "@/modules/support/queries";
import { BillingStateBadge } from "../../billing-state-badge";
import { SupportControl } from "../../support-control";
import { ArchiveControls } from "./archive-controls";
import { LockControls } from "./lock-controls";
import { ModulesCard } from "./modules-card";
import { PackageCard } from "./package-card";
import { PaymentsTable } from "./payments-table";

export default function PlatformOrganizationPage({
  params,
}: PageProps<"/platform/organizations/[id]">) {
  return (
    <PageSuspense>
      <OrganizationContent params={params} />
    </PageSuspense>
  );
}

async function OrganizationContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const [t, tb, format, access] = await Promise.all([
    getTranslations("platform"),
    getTranslations("platform.billing"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const id = z.uuid().safeParse((await params).id);
  const [billing, packages, support] = await Promise.all([
    id.success ? getOrganizationBilling(id.data) : Promise.resolve(null),
    listBillingPackages(),
    listPlatformSupportRequests(),
  ]);
  const back = (
    <Link
      href="/platform"
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      {tb("back")}
    </Link>
  );
  if (!billing) {
    return (
      <EmptyState
        icon={<BuildingIcon />}
        title={tb("notFoundTitle")}
        description={tb("notFoundDescription")}
        action={
          <Link href="/platform" className={cn(buttonVariants({ variant: "outline" }))}>
            {tb("back")}
          </Link>
        }
      />
    );
  }

  const { organization } = billing;
  const timezone = organization.timezone;
  const day = (value: string) => new Date(`${value}T12:00:00Z`);
  const month = (period: string) =>
    format.dateTime(day(period), { month: "long", year: "numeric", timeZone: timezone });
  const date = (value: string) =>
    format.dateTime(day(value), { dateStyle: "long", timeZone: timezone });
  const unpaidMonth = billing.unpaidPeriod ? month(billing.unpaidPeriod) : "";
  // lock_on is the day after the due date.
  const dueDay = billing.lockOn
    ? new Date(day(billing.lockOn).getTime() - 86_400_000).toISOString().slice(0, 10)
    : null;
  const banner =
    billing.state === "locked"
      ? billing.reason === "manual"
        ? tb("banner.locked.manual", {
            date: billing.lockedAt
              ? format.dateTime(new Date(billing.lockedAt), {
                  dateStyle: "long",
                  timeZone: timezone,
                })
              : "",
            reason: billing.lockedReason ?? "",
          })
        : tb("banner.locked.unpaid", { month: unpaidMonth, due: dueDay ? date(dueDay) : "" })
      : billing.state === "warning"
        ? tb("banner.warning", {
            month: unpaidMonth,
            date: billing.lockOn ? date(billing.lockOn) : "",
          })
        : billing.state === "overdue"
          ? tb("banner.overdue", { month: unpaidMonth })
          : null;
  const archivedStrip = organization.archivedAt
    ? organization.archivedReason
      ? tb("archive.banner", {
          date: format.dateTime(new Date(organization.archivedAt), {
            dateStyle: "long",
            timeZone: timezone,
          }),
          reason: organization.archivedReason,
        })
      : tb("archive.bannerNoReason", {
          date: format.dateTime(new Date(organization.archivedAt), {
            dateStyle: "long",
            timeZone: timezone,
          }),
        })
    : null;
  const scheduledStrip = organization.deleteAfter
    ? tb("archive.scheduledBanner", {
        date: format.dateTime(new Date(organization.deleteAfter), {
          dateStyle: "long",
          timeZone: timezone,
        }),
      })
    : null;
  const can = (key: PermissionKey) => access.permissions.has(key);
  const choices = packages.filter((p) => !p.archived || p.id === billing.package?.id);

  return (
    <>
      <div className="flex flex-col gap-3">
        {back}
        {archivedStrip ? (
          <Alert data-testid="archived-strip">
            <AlertDescription>{archivedStrip}</AlertDescription>
          </Alert>
        ) : null}
        {scheduledStrip ? (
          <Alert variant="destructive" data-testid="deletion-strip">
            <AlertDescription>{scheduledStrip}</AlertDescription>
          </Alert>
        ) : null}
        {banner && !organization.archived ? (
          <Alert variant={billing.state === "locked" ? "destructive" : "default"}>
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
              <BillingStateBadge state={billing.state} />
              {organization.archived ? (
                <StatusBadge tone="neutral">{t("archived")}</StatusBadge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {tb("header", {
                slug: organization.slug,
                members: t("members", { count: organization.memberCount }),
                date: format.dateTime(new Date(organization.createdAt), { dateStyle: "medium" }),
              })}
              {organization.taxId ? ` · ${organization.taxId}` : ""}
              {organization.city ? ` · ${organization.city}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-end justify-end gap-2">
              {can("platform.support") ? (
                <SupportControl
                  organizationId={organization.id}
                  request={support.get(organization.id) ?? null}
                  compact
                />
              ) : null}
              {can("platform.organizations.archive") || can("platform.organizations.delete") ? (
                <ArchiveControls
                  organizationId={organization.id}
                  name={organization.name}
                  timezone={timezone}
                  archived={organization.archived}
                  deletionScheduled={organization.deleteAfter !== null}
                  canArchive={can("platform.organizations.archive")}
                  canDelete={can("platform.organizations.delete")}
                />
              ) : null}
              {can("platform.lock") && !organization.archived ? (
                <LockControls
                  organizationId={organization.id}
                  name={organization.name}
                  lockedByHand={billing.lockedAt !== null}
                  lockedForPayment={billing.reason === "unpaid"}
                  unlockedUntil={billing.unlockedUntil}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PackageCard
          organizationId={organization.id}
          packages={choices.map((p) => ({ id: p.id, name: p.name, modules: p.modules }))}
          packageId={billing.package?.id ?? null}
          monthlyPrice={billing.package?.monthlyPrice ?? null}
          graceDays={billing.graceDays}
          defaultGraceDays={billing.effectiveGraceDays}
          autoLock={billing.autoLock}
          modules={billing.modules}
          canAssign={can("platform.packages.assign")}
          canBilling={can("platform.lock")}
        />
        <ModulesCard
          organizationId={organization.id}
          modules={billing.modules}
          today={zonedDate(new Date(), "Europe/Sarajevo")}
          canManage={can("platform.modules.manage")}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tb("payments.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentsTable
            organizationId={organization.id}
            months={billing.months}
            today={zonedDate(new Date(), timezone)}
            timezone={timezone}
            canRecord={can("platform.payments.record")}
            canCancel={can("platform.payments.cancel")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tb("history.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {billing.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tb("history.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {billing.history.map((entry) => (
                <li key={`${entry.createdAt}-${entry.action}`} className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground tabular-nums">
                    {format.dateTime(new Date(entry.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: timezone,
                    })}
                  </span>
                  <span>
                    {tb.has(
                      `history.actions.${entry.action.replace(/^billing\./, "")}` as "history.title",
                    )
                      ? tb(
                          `history.actions.${entry.action.replace(/^billing\./, "")}` as "history.title",
                        )
                      : entry.action}
                  </span>
                  {entry.actor ? (
                    <span className="text-muted-foreground">· {entry.actor}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
