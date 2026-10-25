"use client";

import { PaperclipIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { FileTypeIcon, OpenOrderFileButton } from "@/components/shared/open-order-file";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { OrderAttachment, OrderOperation } from "@/modules/production-orders/queries";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toString().replace(".", ",")} MB`;
}

/** Drawings frozen on the order; replaced ones only on request. */
export function OrderAttachmentsPanel({
  attachments,
  operations,
  revisionLabel,
}: {
  attachments: OrderAttachment[];
  operations: OrderOperation[];
  revisionLabel: string;
}) {
  const t = useTranslations("orders.attachments");
  const tKinds = useTranslations("products.attachments.kinds");
  const [showReplaced, setShowReplaced] = useState(false);
  const replacedCount = attachments.filter((a) => a.replacedAt !== null).length;
  const visible = showReplaced ? attachments : attachments.filter((a) => a.replacedAt === null);
  const operationCode = (productOperationId: string | null) =>
    operations.find((op) => op.sourceOperationId === productOperationId)?.type.code ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("frozenHint", { revision: revisionLabel })}
        </p>
        {replacedCount > 0 ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="order-show-replaced"
              checked={showReplaced}
              onCheckedChange={(value) => setShowReplaced(value === true)}
            />
            <Label htmlFor="order-show-replaced">
              {t("showReplaced", { count: replacedCount })}
            </Label>
          </div>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<PaperclipIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {visible.map((attachment) => {
            const code =
              attachment.kind === "machine_drawing"
                ? operationCode(attachment.productOperationId)
                : null;
            return (
              <li
                key={attachment.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <FileTypeIcon contentType={attachment.contentType} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {attachment.title ?? attachment.fileName}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{tKinds(attachment.kind)}</span>
                      {code ? <span>· {t("forOperation", { code })}</span> : null}
                      <span>· {formatSize(attachment.sizeBytes)}</span>
                      {attachment.replacedAt ? (
                        <Badge variant="secondary">{t("replaced")}</Badge>
                      ) : null}
                    </span>
                  </div>
                </div>
                <OpenOrderFileButton
                  attachmentId={attachment.attachmentId}
                  label={t("open")}
                  size="sm"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
