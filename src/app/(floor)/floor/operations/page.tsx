import { ClipboardListIcon, SearchIcon, UserXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import { listMyMachines } from "@/modules/machines/queries";
import { getAllMyFloorOperations, getFloorQueue } from "@/modules/production-orders/floor";
import { matchesFloorSearch } from "@/modules/production-orders/floor-rules";
import { FloorOperationCard } from "../operation-card";

// All orders that are at, or will come to, one of the worker's machines (or
// are assigned to them by name), most urgent first. Search covers all of them.

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
  const [t, access] = await Promise.all([getTranslations("floorOrders"), getMemberAccess(member)]);
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

  const params = await searchParams;
  const query = z
    .string()
    .trim()
    .max(100)
    .catch("")
    .parse(firstParam(params.q) ?? "");
  const requested = firstParam(params.machine);
  const machines = mine.machines.filter((machine) => !machine.archived);
  const selected =
    requested === MINE
      ? MINE
      : (machines.find((machine) => machine.id === z.uuid().catch("").parse(requested))?.id ??
        machines[0]?.id ??
        MINE);
  const queue = query
    ? (
        await getAllMyFloorOperations(
          organizationId,
          machines.map((machine) => machine.id),
        )
      ).filter((item) => matchesFloorSearch(item, query))
    : await getFloorQueue(organizationId, selected === MINE ? null : selected);

  const chip = (value: string, label: string) => (
    <Link
      key={value}
      href={`/floor/operations?machine=${value}`}
      aria-current={!query && selected === value ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap",
        !query && selected === value
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
      <form action="/floor/operations" role="search" className="flex gap-2">
        <Input
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="h-12 text-base"
        />
        <Button type="submit" size="icon-lg" className="size-12" aria-label={t("searchLabel")}>
          <SearchIcon />
        </Button>
      </form>
      <nav aria-label={t("machinePicker")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {machines.map((machine) => chip(machine.id, machine.code))}
        {chip(
          MINE,
          access.permissions.has("quality.inspect") ? t("inspections") : t("assignedToMe"),
        )}
      </nav>
      {query ? (
        <p className="text-sm text-muted-foreground">
          {t("searchResults", { query, count: queue.length })}
        </p>
      ) : null}

      {queue.length === 0 ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("emptyTitle")}
          description={
            query ? t("emptySearch") : selected === MINE ? t("emptyMine") : t("emptyMachine")
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.map((item) => (
            <li key={item.operationId}>
              <FloorOperationCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
