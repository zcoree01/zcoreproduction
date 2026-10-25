"use client";

import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  FileStackIcon,
  PencilIcon,
  PrinterIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CutQuantitySheet } from "@/components/shared/cut-quantity-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { replaceDrawingsAction, setOrderStatusAction } from "@/modules/production-orders/actions";
import type { OrderDetail } from "@/modules/production-orders/queries";
import type { PriorityMode } from "@/modules/production-orders/rules";
import {
  allowedOrderTargets,
  CLOSED_STATUSES,
  completionBlocked,
  type OrderStatus,
  type StatusActor,
} from "@/modules/production-orders/status-rules";
import { CopyOrderSheet, EditOrderSheet } from "../order-sheet";

/** Status change: allowed targets for the member; cancelling asks for a reason. */
export function OrderStatusControl({
  orderId,
  orderNumber,
  status,
  actor,
  completionAllowed,
  cuttingOpen,
  wholePieces,
  quantity,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  actor: StatusActor;
  /** Every operation done with enough good pieces, or closing approved. */
  completionAllowed: boolean;
  /** A cutting operation is not done: "ready" asks for the cut pieces. */
  cuttingOpen: boolean;
  wholePieces: boolean;
  quantity: string;
}) {
  const t = useTranslations("orders.status");
  const tStatus = useTranslations("orderStatus");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [cutting, setCutting] = useState(false);
  const targets = allowedOrderTargets(status, actor);
  if (targets.length === 0) return null;

  const change = (to: OrderStatus, reason?: string) =>
    startTransition(async () => {
      const result = await setOrderStatusAction(orderId, { status: to, reason: reason ?? "" });
      if (result.ok) {
        toast.success(t("changedToast", { number: orderNumber, status: tStatus(to) }));
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button disabled={pending} />}>
          {t("change")}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("moveTo")}</DropdownMenuLabel>
            {targets.map((to) => {
              const blocked = to === "completed" && completionBlocked({ completionAllowed });
              return (
                <DropdownMenuItem
                  key={to}
                  disabled={blocked}
                  variant={to === "cancelled" ? "destructive" : "default"}
                  onClick={() => {
                    if (to === "cancelled") setCancelling(true);
                    else if (to === "archived") setArchiving(true);
                    else if (to === "ready" && cuttingOpen) setCutting(true);
                    else change(to);
                  }}
                >
                  <span className="flex flex-col">
                    <span>{tStatus(to)}</span>
                    {blocked ? (
                      <span className="text-xs text-muted-foreground">
                        {t("completionBlocked")}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CancelSheet
        open={cancelling}
        onOpenChange={setCancelling}
        orderNumber={orderNumber}
        onCancel={(reason) => {
          setCancelling(false);
          change("cancelled", reason);
        }}
      />
      <CutQuantitySheet
        open={cutting}
        onOpenChange={setCutting}
        orderId={orderId}
        orderNumber={orderNumber}
        suggested={quantity}
        wholePieces={wholePieces}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("archiveTitle", { number: orderNumber })}
        description={t("archiveDescription")}
        confirmLabel={tStatus("archived")}
        onConfirm={() => change("archived")}
      />
    </>
  );
}

function CancelSheet({
  open,
  onOpenChange,
  orderNumber,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber: string;
  onCancel: (reason: string) => void;
}) {
  const t = useTranslations("orders.status");
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("cancelTitle", { number: orderNumber })}</SheetTitle>
          <SheetDescription>{t("cancelDescription")}</SheetDescription>
        </SheetHeader>
        <form
          id="order-cancel-form"
          className="flex-1 overflow-y-auto p-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (trimmed.length === 0 || trimmed.length > 500) {
              setInvalid(true);
              return;
            }
            onCancel(trimmed);
            setReason("");
            setInvalid(false);
          }}
        >
          <FieldGroup>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="order-cancel-reason">{t("cancelReason")}</FieldLabel>
              <Textarea
                id="order-cancel-reason"
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={invalid || undefined}
              />
              {invalid ? (
                <FieldError>{t("cancelReasonRequired")}</FieldError>
              ) : (
                <FieldDescription>{t("cancelReasonHint")}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="order-cancel-form" variant="destructive">
            {t("cancelConfirm")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Edit, copy (repeat order), print and drawing change. */
export function OrderActions({
  order,
  priorityMode,
}: {
  order: OrderDetail;
  priorityMode: PriorityMode;
}) {
  const t = useTranslations("orders.detail");
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const closed = CLOSED_STATUSES.includes(order.status);

  return (
    <>
      <Link
        href={`/orders/${order.id}/print`}
        target="_blank"
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        <PrinterIcon />
        {t("print")}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" aria-label={t("moreActions")} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {!closed ? (
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon />
              {t("edit")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setCopying(true)}>
            <CopyIcon />
            {t("copy")}
          </DropdownMenuItem>
          {!closed ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setReplacing(true)}>
                <FileStackIcon />
                {t("replaceDrawings")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditOrderSheet
        open={editing}
        onOpenChange={setEditing}
        order={order}
        priorityMode={priorityMode}
      />
      <CopyOrderSheet
        open={copying}
        onOpenChange={setCopying}
        order={order}
        priorityMode={priorityMode}
      />
      <ReplaceDrawingsSheet open={replacing} onOpenChange={setReplacing} order={order} />
    </>
  );
}

function ReplaceDrawingsSheet({
  open,
  onOpenChange,
  order,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
}) {
  const t = useTranslations("orders.drawings");
  const router = useRouter();
  const others = order.revisions.filter((r) => r.id !== order.revisionId);
  const [revisionId, setRevisionId] = useState(others[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const label = (r: { revision: string | null; isCurrent: boolean }) =>
    r.isCurrent
      ? t("revisionCurrent", { revision: r.revision ?? t("unlabeled") })
      : t("revisionOld", { revision: r.revision ?? t("unlabeled") });

  const replace = () =>
    startTransition(async () => {
      const result = await replaceDrawingsAction(order.id, revisionId);
      if (result.ok) {
        toast.success(t("replacedToast", { number: order.orderNumber }));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("title", { number: order.orderNumber })}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <FieldGroup>
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>{t("warningTitle")}</AlertTitle>
              <AlertDescription>{t("warning")}</AlertDescription>
            </Alert>
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOtherRevisions")}</p>
            ) : (
              <Field>
                <FieldLabel htmlFor="order-replace-revision">{t("revision")}</FieldLabel>
                <NativeSelect
                  id="order-replace-revision"
                  className="w-full"
                  value={revisionId}
                  onChange={(event) => setRevisionId(event.target.value)}
                >
                  {others.map((r) => (
                    <NativeSelectOption key={r.id} value={r.id}>
                      {label(r)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>{t("revisionHint")}</FieldDescription>
              </Field>
            )}
          </FieldGroup>
        </div>
        <SheetFooter className="border-t">
          <Button onClick={replace} disabled={pending || others.length === 0 || !revisionId}>
            {pending ? t("replacing") : t("confirm")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
