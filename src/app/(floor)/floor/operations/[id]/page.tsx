import { ArrowLeftIcon, ClipboardXIcon, EyeOffIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { Duration } from "@/components/shared/duration";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { FileTypeIcon, OpenOrderFileButton } from "@/components/shared/open-order-file";
import {
  OperationStatusBadge,
  OrderStatusBadge,
  PriorityBadge,
} from "@/components/shared/order-badges";
import { PageSuspense } from "@/components/shared/page-suspense";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { formatDecimal } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { getFloorOperation } from "@/modules/production-orders/floor";
import { barPlan } from "@/modules/production-orders/rules";
import { isWholeUnit } from "@/modules/production-orders/schemas";
import { MATERIAL_STATUSES, type OrderStatus } from "@/modules/production-orders/status-rules";
import { getOperationWork, listReasons } from "@/modules/production-reporting/queries";
import { MaterialStatusButtons } from "./material-status";
import { WorkPanel } from "./work-panel";

// One operation on the worker's phone (target of the QR code on the printed
// order). Operations of other workers only show where the order is now.

export default function FloorOperationPage({ params }: PageProps<"/floor/operations/[id]">) {
  return (
    <PageSuspense>
      <FloorOperationContent params={params} />
    </PageSuspense>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-base font-medium">{children ?? "—"}</dd>
    </div>
  );
}

const MATERIAL_CONTEXT: readonly OrderStatus[] = ["planned", ...MATERIAL_STATUSES];

async function FloorOperationContent({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const [t, tUnits, format, access] = await Promise.all([
    getTranslations("floorOrders"),
    getTranslations("productUnits"),
    getFormatter(),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("production")) return <ModuleDisabled />;

  const back = (
    <Link
      href="/floor/operations"
      className="inline-flex min-h-12 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      {t("back")}
    </Link>
  );

  const { id } = await params;
  const operationId = z.uuid().safeParse(id);
  const result = operationId.success ? await getFloorOperation(operationId.data) : null;
  if (!result) {
    return (
      <>
        {back}
        <EmptyState
          icon={<ClipboardXIcon />}
          title={t("notFoundTitle")}
          description={t("notFoundDescription")}
        />
      </>
    );
  }

  if (!result.visible) {
    return (
      <>
        {back}
        <EmptyState
          icon={<EyeOffIcon />}
          title={t("notAssignedTitle")}
          description={t("notAssignedDescription", { number: result.order_number })}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("currentOperation")}</CardTitle>
          </CardHeader>
          <CardContent>
            {result.current ? (
              <p className="text-lg">
                <span className="font-mono font-semibold">{result.current.code}</span>{" "}
                {result.current.name}
                {result.current.machine_code ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {t("onMachine", { machine: result.current.machine_code })}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground">{t("allDone")}</p>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const { order, operation, operations, attachments } = result;
  const reporting = !operation.is_cutting && !operation.is_external;
  const [work, downtimeReasons, scrapReasons, toolReasons] = reporting
    ? await Promise.all([
        getOperationWork(operation.id),
        listReasons(member.organization.id, "downtime_reason"),
        listReasons(member.organization.id, "scrap_reason"),
        listReasons(member.organization.id, "tool_change_reason"),
      ])
    : [null, [], [], []];
  const plan = barPlan({
    barLength: order.bar_length_mm,
    remnant: order.bar_remnant_mm,
    pieceLength: order.piece_length_mm,
    kerf: order.kerf_mm,
    quantity: order.quantity,
    wholePieces: isWholeUnit(order.unit),
  });
  const showMaterial =
    order.can_set_material && operation.is_cutting && MATERIAL_CONTEXT.includes(order.status);
  const drawings = attachments.filter((a) => a.kind === "main_drawing" || a.kind === "image");
  const machineDrawings = attachments.filter((a) => a.kind === "machine_drawing");
  const others = attachments.filter((a) => a.kind === "other");

  return (
    <>
      {back}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={order.effective_priority} />
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="font-mono text-2xl font-semibold">{order.order_number}</h1>
        <p className="text-base">
          <span className="font-mono font-medium">{order.part_number}</span> · {order.product_name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <Badge variant="outline" className="font-mono text-base">
              {operation.code}
            </Badge>
            {operation.name}
            <OperationStatusBadge status={operation.status} external={operation.is_external} />
          </CardTitle>
          {operation.description ? (
            <p className="text-sm text-muted-foreground">{operation.description}</p>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label={t("toMake")}>
              <span className="text-2xl tabular-nums">
                {formatDecimal(order.quantity)} {tUnits(order.unit)}
              </span>
            </Row>
            <Row label={t("machine")}>
              {operation.is_external
                ? operation.external_company
                : operation.machine_code
                  ? `${operation.machine_code} · ${operation.machine_name ?? ""}`
                  : null}
            </Row>
            <Row label={t("dueDate")}>
              {format.dateTime(new Date(`${order.due_date}T12:00:00Z`), {
                dateStyle: "medium",
                timeZone: "UTC",
              })}
            </Row>
            <Row label={t("drawing")}>
              {[
                order.drawing_number,
                order.revision ? t("revision", { revision: order.revision }) : null,
              ]
                .filter(Boolean)
                .join(" · ") || null}
            </Row>
            <Row label={t("materialLabel")}>{order.material}</Row>
            {order.piece_length_mm ? (
              <Row label={t("pieceLength")}>
                {`${formatDecimal(order.piece_length_mm)} mm`}
                {order.kerf_mm ? ` + ${formatDecimal(order.kerf_mm)} mm` : ""}
              </Row>
            ) : null}
            {plan ? (
              <Row label={t("bar")}>
                {t("barValue", {
                  bar: formatDecimal(order.bar_length_mm ?? "0"),
                  pieces: plan.piecesPerBar,
                })}
              </Row>
            ) : null}
            <Row label={t("plannedTime")}>
              {operation.planned_seconds ? <Duration seconds={operation.planned_seconds} /> : null}
            </Row>
            {operation.workers.length > 0 ? (
              <Row label={t("workers")}>{operation.workers.join(", ")}</Row>
            ) : null}
          </dl>
          {operation.notes ? (
            <p className="mt-3 rounded-lg bg-muted p-3 text-sm whitespace-pre-line">
              {operation.notes}
            </p>
          ) : null}
          {order.notes ? (
            <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">{order.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      {work ? (
        <WorkPanel
          operationId={operation.id}
          orderId={order.id}
          orderNumber={order.order_number}
          orderQuantity={order.quantity ?? "0"}
          operationStatus={operation.status}
          isInspection={operation.is_inspection}
          unitLabel={tUnits(order.unit)}
          wholePieces={isWholeUnit(order.unit)}
          timezone={member.organization.timezone}
          work={work}
          downtimeReasons={downtimeReasons}
          scrapReasons={scrapReasons}
          toolReasons={toolReasons}
        />
      ) : null}

      {showMaterial ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("materialTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MaterialStatusButtons
              orderId={order.id}
              orderNumber={order.order_number}
              status={order.status}
              cuttingOpen={operation.status !== "done"}
              quantity={order.quantity ?? "0"}
              wholePieces={isWholeUnit(order.unit)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("drawingsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDrawings")}</p>
          ) : (
            [...machineDrawings, ...drawings, ...others].map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileTypeIcon contentType={file.content_type} />
                  <span className="truncate">{file.title ?? file.file_name}</span>
                  {file.kind === "machine_drawing" ? (
                    <Badge variant="secondary">
                      {file.for_operation ? t("forThisOperation") : t("machineDrawing")}
                    </Badge>
                  ) : null}
                </span>
                <OpenOrderFileButton attachmentId={file.id} label={t("open")} className="h-12" />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("routingTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2">
            {operations.map((op) => (
              <li
                key={op.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg px-2 py-1",
                  op.id === operation.id && "bg-muted font-medium",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono">{op.code}</span>
                  <span className="text-sm">{op.name}</span>
                  {op.machine_code ? (
                    <span className="text-xs text-muted-foreground">{op.machine_code}</span>
                  ) : null}
                </span>
                <OperationStatusBadge status={op.status} external={op.is_external} />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
