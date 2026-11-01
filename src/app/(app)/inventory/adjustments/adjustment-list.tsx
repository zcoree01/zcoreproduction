"use client";

import { CheckIcon, InboxIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { decideAdjustmentAction } from "@/modules/inventory/actions";
import type { AdjustmentDocument } from "@/modules/inventory/queries";

type Adjustment = AdjustmentDocument & { createdLabel: string };
import { isDimensionedUnit } from "@/modules/inventory/rules";
import { useStockFormat } from "../use-stock-format";

export function AdjustmentList({
  adjustments,
  canApprove,
}: {
  adjustments: Adjustment[];
  canApprove: boolean;
}) {
  const t = useTranslations("inventory.adjustments");
  const pending = adjustments.filter((a) => a.status === "pending");
  const decided = adjustments.filter((a) => a.status !== "pending");

  if (adjustments.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("pending")}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPending")}</p>
        ) : (
          pending.map((doc) => <AdjustmentCard key={doc.id} doc={doc} canApprove={canApprove} />)
        )}
      </section>
      {decided.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("decided")}</h2>
          {decided.map((doc) => (
            <AdjustmentCard key={doc.id} doc={doc} canApprove={false} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function AdjustmentCard({ doc, canApprove }: { doc: Adjustment; canApprove: boolean }) {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const format = useStockFormat();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [noteMissing, setNoteMissing] = useState(false);
  const [busy, startTransition] = useTransition();

  const decide = (approve: boolean) =>
    startTransition(async () => {
      setNoteMissing(false);
      const result = await decideAdjustmentAction({ documentId: doc.id, approve, note });
      if (result.ok) {
        toast.success(t(approve ? "adjustments.approved" : "adjustments.rejected"));
        setRejecting(false);
      } else if (result.fields.includes("note")) {
        setNoteMissing(true);
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  const variant =
    doc.status === "pending" ? "outline" : doc.status === "posted" ? "secondary" : "destructive";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {doc.number}
          <Badge variant={variant}>{t(`adjustments.status.${doc.status}`)}</Badge>
        </CardTitle>
        <CardDescription className="flex flex-col gap-0.5">
          <span>{doc.reason}</span>
          <span>
            {doc.createdLabel}
            {doc.requestedBy ? ` · ${t("adjustments.requestedBy", { name: doc.requestedBy })}` : ""}
            {doc.decidedBy ? ` · ${t("adjustments.decidedBy", { name: doc.decidedBy })}` : ""}
          </span>
          {doc.decisionNote ? (
            <span>{t("adjustments.decisionNote", { note: doc.decisionNote })}</span>
          ) : null}
        </CardDescription>
        {canApprove && !rejecting ? (
          <CardAction className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => decide(true)}>
              <CheckIcon />
              {t("adjustments.approve")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
              <XIcon />
              {t("adjustments.reject")}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {doc.lines.map((line, index) => {
            const amount =
              isDimensionedUnit(line.baseUnit) && line.pieces !== null
                ? format.pieces(line.pieces, line.length, line.width)
                : format.quantity(line.baseUnit, line.quantity ?? "0");
            return (
              <li key={index} className="flex flex-wrap gap-x-2">
                <Link href={`/inventory/${line.itemId}`} className="font-medium hover:underline">
                  {line.itemCode} · {line.itemName}
                </Link>
                <span className="text-muted-foreground">
                  {line.location} · {line.lotNumber ?? t("adjustments.lotNew")}
                </span>
                <span className="tabular-nums">{amount}</span>
              </li>
            );
          })}
        </ul>
        {rejecting ? (
          <div className="flex flex-col gap-2">
            <Field data-invalid={noteMissing || undefined}>
              <FieldLabel htmlFor={`reject-${doc.id}`}>{t("adjustments.rejectReason")}</FieldLabel>
              <Textarea
                id={`reject-${doc.id}`}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                aria-invalid={noteMissing || undefined}
              />
              {noteMissing ? <FieldError>{t("errors.reason_required")}</FieldError> : null}
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide(false)}>
                {t("adjustments.reject")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                {tCommon("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
