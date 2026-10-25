import { ArrowLeftIcon, ClipboardXIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { OrderStatusBadge, PriorityBadge } from "@/components/shared/order-badges";
import { OrderProgress } from "@/components/shared/order-progress";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import { parseOrderTab } from "@/modules/production-orders/list-params";
import { isWholeUnit } from "@/modules/production-orders/schemas";
import {
  getOrder,
  getOrderHistory,
  getOrderSettings,
  getOrderStatusLog,
  listAssignmentOptions,
  listOrderAttachments,
  listOrderOperations,
} from "@/modules/production-orders/queries";
import { getOrderProduction } from "@/modules/production-reporting/queries";
import { getProductionSettings, listOperationTypes } from "@/modules/products/queries";
import { OrderAttachmentsPanel } from "./attachments-panel";
import { OrderHistoryPanel } from "./history-panel";
import { OperationsPanel } from "./operations-panel";
import { OrderActions, OrderStatusControl } from "./order-actions";
import { OrderTabs } from "./order-tabs";
import { OverviewPanel } from "./overview-panel";
import { ProductionPanel } from "./production-panel";

export default function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  return (
    <PageSuspense>
      <OrderContent params={params} searchParams={searchParams} />
    </PageSuspense>
  );
}

async function OrderContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const timezone = member.organization.timezone;
  const [t, tUnits, format, access] = await Promise.all([
    getTranslations("orders"),
    getTranslations("productUnits"),
    getFormatter(),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("orders.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const { id } = await params;
  const tab = parseOrderTab(await searchParams);
  const orderId = z.uuid().safeParse(id);
  const order = orderId.success ? await getOrder(organizationId, orderId.data) : null;
  if (!order) {
    return (
      <EmptyState
        icon={<ClipboardXIcon />}
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        action={
          <Link href="/orders" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("detail.back")}
          </Link>
        }
      />
    );
  }

  const canManage = access.permissions.has("orders.manage");
  const actor = {
    manage: canManage,
    material: access.permissions.has("orders.material.update"),
  };
  const [
    operations,
    production,
    attachments,
    statusLog,
    history,
    settings,
    productionSettings,
    assignment,
    types,
  ] = await Promise.all([
    listOrderOperations(organizationId, order.id),
    getOrderProduction(order.id),
    listOrderAttachments(organizationId, order.id),
    getOrderStatusLog(order.id),
    getOrderHistory(order.id),
    getOrderSettings(organizationId),
    getProductionSettings(organizationId),
    canManage
      ? listAssignmentOptions(organizationId)
      : Promise.resolve({ machines: [], employees: [] }),
    canManage ? listOperationTypes(organizationId) : Promise.resolve([]),
  ]);
  const stamp = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const revisionLabel = order.revision ?? t("overview.unlabeled");
  const cuttingOpen = operations.some(
    (op) => !op.archived && op.type.isCutting && op.status !== "done",
  );
  const missingMachines = operations.filter(
    (op) => !op.archived && !op.machine && !op.type.isExternal && !op.type.isInspection,
  ).length;

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link
          href="/orders"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">
                {order.orderNumber}
              </h1>
              <OrderStatusBadge status={order.status} closeRequested={order.closeRequestPending} />
              <PriorityBadge
                priority={order.effectivePriority}
                automatic={settings.priorityMode === "automatic" && order.priority === null}
              />
            </div>
            <p className="text-lg">
              {order.product ? `${order.product.partNumber} · ${order.product.name}` : null}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("detail.statusSince", { time: stamp(order.statusChangedAt) })}
            </p>
            <OrderProgress order={order} className="w-72" />
            <p className="text-sm font-medium tabular-nums" data-testid="order-good-quantity">
              {t("detail.goodProgress", {
                good: formatDecimal(order.goodQuantity),
                quantity: formatDecimal(order.quantity),
                unit: tUnits(order.unit),
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusControl
              orderId={order.id}
              orderNumber={order.orderNumber}
              status={order.status}
              actor={actor}
              completionAllowed={order.completionAllowed}
              cuttingOpen={cuttingOpen}
              wholePieces={isWholeUnit(order.unit)}
              quantity={order.quantity}
            />
            {canManage ? <OrderActions order={order} priorityMode={settings.priorityMode} /> : null}
          </div>
        </div>
      </div>

      {canManage &&
      missingMachines > 0 &&
      (order.status === "draft" || order.status === "planned") ? (
        <Alert>
          <AlertDescription>
            {t("detail.missingMachines", { count: missingMachines })}
          </AlertDescription>
        </Alert>
      ) : null}

      <OrderTabs
        initialTab={tab}
        counts={{
          operations: operations.filter((op) => !op.archived).length,
          production: production.reports.filter((row) => row.voidedAt === null).length,
          attachments: attachments.filter((a) => a.replacedAt === null).length,
        }}
        panels={{
          overview: (
            <OverviewPanel
              order={order}
              priorityMode={settings.priorityMode}
              canReadProducts={access.permissions.has("products.read")}
              canReadCustomers={access.permissions.has("customers.read")}
            />
          ),
          operations: (
            <OperationsPanel
              orderId={order.id}
              orderStatus={order.status}
              operations={operations}
              operationTypes={types}
              assignment={{ ...assignment, timezone }}
              defaultUnit={productionSettings.cycleTimeUnit}
              canManage={canManage}
            />
          ),
          production: (
            <ProductionPanel
              orderId={order.id}
              orderNumber={order.orderNumber}
              orderStatus={order.status}
              quantity={order.quantity}
              goodQuantity={order.goodQuantity}
              unit={order.unit}
              production={{
                reports: production.reports.map((row) => ({
                  ...row,
                  reportedLabel: stamp(row.reportedAt),
                })),
                downtime: production.downtime.map((row) => ({
                  ...row,
                  startedLabel: stamp(row.startedAt),
                  endedLabel: row.endedAt ? stamp(row.endedAt) : null,
                })),
                closeRequests: production.closeRequests.map((row) => ({
                  ...row,
                  requestedLabel: stamp(row.requestedAt),
                  decidedLabel: row.decidedAt ? stamp(row.decidedAt) : null,
                })),
              }}
              can={{
                void: canManage,
                approve: access.permissions.has("orders.close.approve"),
                request: canManage || access.permissions.has("quality.inspect"),
              }}
            />
          ),
          attachments: (
            <OrderAttachmentsPanel
              attachments={attachments}
              operations={operations}
              revisionLabel={revisionLabel}
            />
          ),
          history: (
            <OrderHistoryPanel
              statusLog={statusLog.map((entry) => ({
                ...entry,
                createdLabel: stamp(entry.changedAt),
              }))}
              entries={history.map((entry) => ({ ...entry, createdLabel: stamp(entry.createdAt) }))}
              externalSequences={operations
                .filter((op) => op.type.isExternal)
                .map((op) => op.sequence)}
            />
          ),
        }}
      />
    </>
  );
}
