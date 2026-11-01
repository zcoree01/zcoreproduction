"use client";

import { FileTextIcon, PackageOpenIcon, UploadIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import { createClient } from "@/lib/supabase/client";
import {
  certificateUrlAction,
  prepareCertificateUploadAction,
  registerCertificateAction,
  setCertificateArchivedAction,
} from "@/modules/inventory/actions";
import type { StockLotRow } from "@/modules/inventory/queries";
import {
  CERTIFICATE_CONTENT_TYPES,
  CERTIFICATE_MAX_BYTES,
  CERTIFICATES_BUCKET,
  certificateMetaSchema,
  type CertificateError,
} from "@/modules/inventory/schemas";

const ACCEPT = Object.keys(CERTIFICATE_CONTENT_TYPES).join(",");

/**
 * Uploads one certificate: the server issues a signed URL for a path it
 * chooses, the browser uploads directly to Storage, the server records it.
 */
async function uploadCertificate(
  lotId: string,
  file: File,
): Promise<
  | { ok: true }
  | { ok: false; error: CertificateError | "invalid" | "denied" | "not_found" | "unexpected" }
> {
  if (file.size > CERTIFICATE_MAX_BYTES) return { ok: false, error: "too_large" };
  const meta = { lotId, fileName: file.name, contentType: file.type, size: file.size };
  const parsed = certificateMetaSchema.safeParse(meta);
  if (!parsed.success) {
    const typeIssue = parsed.error.issues.some((issue) => issue.path[0] === "contentType");
    return { ok: false, error: typeIssue ? "file_type" : "invalid" };
  }

  const ticket = await prepareCertificateUploadAction(meta);
  if (!ticket.ok) return { ok: false, error: ticket.error };

  const supabase = createClient();
  const uploaded = await supabase.storage
    .from(CERTIFICATES_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (uploaded.error) {
    console.error("certificate upload failed", uploaded.error);
    return { ok: false, error: "upload_failed" };
  }

  const result = await registerCertificateAction(meta, ticket.path);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export function LotsPanel({
  lots,
  dateLabels,
  canUpload,
}: {
  lots: StockLotRow[];
  /** Received dates formatted on the server, by lot id. */
  dateLabels: Record<string, string>;
  canUpload: boolean;
}) {
  const t = useTranslations("inventory");

  if (lots.length === 0) {
    return (
      <EmptyState
        icon={<PackageOpenIcon />}
        title={t("detail.lots.emptyTitle")}
        description={t("detail.lots.emptyDescription")}
      />
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {lots.map((lot) => (
        <LotCard key={lot.id} lot={lot} received={dateLabels[lot.id] ?? ""} canUpload={canUpload} />
      ))}
    </div>
  );
}

function LotCard({
  lot,
  received,
  canUpload,
}: {
  lot: StockLotRow;
  received: string;
  canUpload: boolean;
}) {
  const t = useTranslations("inventory");
  const input = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<StockLotRow["certificates"][number] | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    startUpload(async () => {
      const result = await uploadCertificate(lot.id, file);
      if (result.ok) toast.success(t("detail.lots.uploaded"));
      else toast.error(t(`errors.${result.error}`));
      if (input.current) input.current.value = "";
    });
  };

  const open = (id: string) =>
    startTransition(async () => {
      const result = await certificateUrlAction(id);
      if (result.ok) window.open(result.url, "_blank", "noopener");
      else toast.error(t("detail.lots.openFailed"));
    });

  const remove = async () => {
    if (!removing) return;
    const result = await setCertificateArchivedAction(removing.id);
    if (result.ok) toast.success(t("detail.lots.removed"));
    else toast.error(t(`errors.${result.error}`));
    setRemoving(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t("detail.lots.lot", { lot: lot.lotNumber })}
          {lot.ownerCustomer ? (
            <Badge variant="outline">
              {t("detail.lots.customer", { name: lot.ownerCustomer })}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription className="flex flex-col gap-0.5">
          <span>
            {lot.heatNumber
              ? t("detail.lots.heat", { heat: lot.heatNumber })
              : t("detail.lots.noHeat")}
          </span>
          <span>{t("detail.lots.received", { date: received })}</span>
          {lot.supplier ? (
            <span>{t("detail.lots.supplier", { supplier: lot.supplier })}</span>
          ) : null}
          {lot.deliveryNote ? (
            <span>{t("detail.lots.deliveryNote", { number: lot.deliveryNote })}</span>
          ) : null}
        </CardDescription>
        {canUpload ? (
          <CardAction>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label={t("detail.lots.upload")}
              onChange={(event) => onFile(event.target.files?.[0])}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              <UploadIcon />
              {uploading ? t("detail.lots.uploading") : t("detail.lots.upload")}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {lot.certificates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.lots.noCertificates")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {lot.certificates.map((certificate) => (
              <li key={certificate.id} className="flex items-center gap-1">
                <Button
                  variant="link"
                  className="h-auto min-w-0 justify-start px-0"
                  disabled={pending}
                  aria-label={t("detail.lots.open", { name: certificate.fileName })}
                  onClick={() => open(certificate.id)}
                >
                  <FileTextIcon />
                  <span className="truncate">{certificate.fileName}</span>
                </Button>
                {canUpload ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("detail.lots.remove", { name: certificate.fileName })}
                    onClick={() => setRemoving(certificate)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? null : setRemoving(null))}
        title={t("detail.lots.removeTitle")}
        description={t("detail.lots.removeDescription")}
        confirmLabel={t("detail.lots.remove", { name: removing?.fileName ?? "" })}
        destructive
        onConfirm={remove}
      />
    </Card>
  );
}
