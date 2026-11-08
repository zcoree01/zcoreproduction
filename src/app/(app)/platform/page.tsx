import { BuildingIcon, SearchIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { listBillingOverview, type BillingOverviewRow } from "@/modules/platform/billing-queries";
import { OVERVIEW_FILTERS, overviewFilter, type OverviewFilter } from "@/modules/platform/schemas";
import { BillingStateBadge } from "./billing-state-badge";
import { SupportEndedNotice } from "./support-ended-notice";

export default function PlatformPage({ searchParams }: PageProps<"/platform">) {
  return (
    <PageSuspense>
      <PlatformContent searchParams={searchParams} />
    </PageSuspense>
  );
}

const matches: Record<OverviewFilter, (row: BillingOverviewRow) => boolean> = {
  all: () => true,
  late: (row) => row.state === "warning" || row.state === "overdue",
  locked: (row) => row.state === "locked",
  trial: (row) => row.state === "trial",
};

async function PlatformContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const [t, tb, format, access, params] = await Promise.all([
    getTranslations("platform"),
    getTranslations("platform.billing"),
    getFormatter(),
    getMemberAccess(member),
    searchParams,
  ]);
  if (!access.modules.has("platform")) return <ModuleDisabled />;
  if (!access.permissions.has("platform.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const filter = overviewFilter(firstParam(params.filter));
  const query = (firstParam(params.q) ?? "").trim().toLowerCase();
  const all = await listBillingOverview();
  // Active organizations first, archived ones at the end.
  const sorted = [...all].sort((a, b) => Number(a.archived) - Number(b.archived));
  const rows = sorted.filter(
    (row) =>
      matches[filter](row) &&
      (query === "" ||
        row.name.toLowerCase().includes(query) ||
        row.slug.toLowerCase().includes(query)),
  );
  const month = (period: string) =>
    format.dateTime(new Date(`${period}T12:00:00Z`), { month: "long", year: "numeric" });
  const href = (next: OverviewFilter) => {
    const search = new URLSearchParams();
    if (next !== "all") search.set("filter", next);
    if (query) search.set("q", query);
    const value = search.toString();
    return value ? `/platform?${value}` : "/platform";
  };

  return (
    <>
      {firstParam(params.support) === "ended" ? <SupportEndedNotice /> : null}
      <PageHeader title={t("organizationsTitle")} description={t("organizationsDescription")} />
      {all.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {OVERVIEW_FILTERS.map((key) => (
              <Link
                key={key}
                href={href(key)}
                aria-current={filter === key ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: filter === key ? "default" : "outline", size: "sm" }),
                )}
              >
                {tb(`filters.${key}`)} ({all.filter(matches[key]).length})
              </Link>
            ))}
            <form action="/platform" className="ml-auto flex items-center gap-2">
              {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={query}
                  placeholder={tb("search")}
                  aria-label={tb("searchLabel")}
                  className="w-56 pl-8"
                />
              </div>
            </form>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tb("emptyFiltered")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tb("columns.organization")}</TableHead>
                    <TableHead>{tb("columns.package")}</TableHead>
                    <TableHead className="text-right">{tb("columns.monthly")}</TableHead>
                    <TableHead>{tb("columns.state")}</TableHead>
                    <TableHead>{tb("columns.lastPaid")}</TableHead>
                    <TableHead className="text-right">{tb("columns.members")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.organizationId}>
                      <TableCell>
                        <Link
                          href={`/platform/organizations/${row.organizationId}`}
                          className="font-medium hover:underline"
                        >
                          {row.name}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">
                          {row.slug}
                          {row.archived ? (
                            <Badge variant="secondary" className="ml-2">
                              {t("archived")}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{row.packageName ?? tb("noPackage")}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.monthlyPrice
                          ? tb("amount", { amount: formatDecimal(row.monthlyPrice) })
                          : tb("noPackage")}
                      </TableCell>
                      <TableCell>
                        <BillingStateBadge state={row.state} />
                      </TableCell>
                      <TableCell>
                        {row.lastPaidPeriod ? month(row.lastPaidPeriod) : tb("noPackage")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.memberCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
