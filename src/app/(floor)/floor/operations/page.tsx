import { ClipboardListIcon, UserXIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import {
  DueWarningBadge,
  OperationStatusBadge,
  PriorityBadge,
} from "@/components/shared/order-badges";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { listMyMachines } from "@/modules/machines/queries";
import { getFloorQueue } from "@/modules/production-orders/floor";

// Worker's queue: operations on one of their machines (or assigned to them by
// name), most urgent first. Read-only until production reporting exists.

export default function FloorOperationsPage({ searchParams }: PageProps<"/floor/operations">) {
  return (
    <PageSuspense>
      <FloorOperationsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

const MINE = "mine";

async function FloorOperationsContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, tUnits, format, access] = await Promise.all([
    getTranslations("floorOrders"),
    getTranslations("productUnits"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("production")) return <ModuleDisabled />;

  const header = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
    </div>
  );

  const mine = await listMyMachines(organizationId, member.userId);
  if (!mine.employee || !mine.employee.active) {
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

  const requested = firstParam((await searchParams).machine);
  const machines = mine.machines.filter((machine) => !machine.archived);
  const selected =
    requested === MINE
      ? MINE
      : (machines.find((machine) => machine.id === z.uuid().catch("").parse(requested))?.id ??
        machines[0]?.id ??
        MINE);
  const queue = await getFloorQueue(organizationId, selected === MINE ? null : selected);

  const chip = (value: string, label: string) => (
    <Link
      key={value}
      href={`/floor/operations?machine=${value}`}
      aria-current={selected === value ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap",
        selected === value
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-foreground hover:bg-muted",
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      {header}
      <nav aria-label={t("machinePicker")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {machines.map((machine) => chip(machine.id, machine.code))}
        {chip(MINE, t("assignedToMe"))}
      </nav>

      {queue.length === 0 ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("emptyTitle")}
          description={selected === MINE ? t("emptyMine") : t("emptyMachine")}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.map((item) => (
            <li key={item.operationId}>
              <Link
                href={`/floor/operations/${item.operationId}`}
                className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Card className="transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <PriorityBadge priority={item.priority} />
                      <span className="font-mono">{item.orderNumber}</span>
                    </CardTitle>
                    <p className="text-sm">
                      <span className="font-mono font-medium">{item.partNumber}</span> ·{" "}
                      {item.productName}
                      {item.revision ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {t("revision", { revision: item.revision })}
                        </span>
                      ) : null}
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {item.operationCode}
                      </Badge>
                      <span className="font-medium">{item.operationName}</span>
                      <OperationStatusBadge status={item.status} />
                      {item.assignedByName ? (
                        <Badge variant="secondary">{t("assignedBadge")}</Badge>
                      ) : null}
                    </div>
                    <p className="text-lg font-semibold tabular-nums">
                      {t("quantity", {
                        quantity: formatDecimal(item.quantity),
                        unit: tUnits(item.unit),
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span>
                        {t("due", {
                          date: format.dateTime(new Date(`${item.dueDate}T12:00:00Z`), {
                            dateStyle: "medium",
                            timeZone: "UTC",
                          }),
                        })}
                      </span>
                      {item.dueWarning === "overdue" || item.dueWarning === "behind" ? (
                        <DueWarningBadge warning={{ kind: item.dueWarning }} />
                      ) : null}
                    </div>
                    {item.previous ? (
                      <p className="text-muted-foreground">
                        {item.previous.status === "done"
                          ? t("previousDone", { code: item.previous.code })
                          : t("previousOpen", { code: item.previous.code })}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">{t("firstOperation")}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
