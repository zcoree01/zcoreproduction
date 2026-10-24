"use client";

import {
  ArchiveIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  RotateCcwIcon,
  UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import {
  getAttachmentUrlAction,
  prepareAttachmentUploadAction,
  registerAttachmentAction,
  setAttachmentArchivedAction,
} from "@/modules/products/actions";
import type { ProductAttachment, ProductOperation } from "@/modules/products/queries";
import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_KINDS,
  ATTACHMENT_MAX_BYTES,
  attachmentMetaSchema,
  PRODUCT_FILES_BUCKET,
  type AttachmentActionResult,
  type AttachmentKind,
} from "@/modules/products/schemas";

type UploadError =
  Extract<AttachmentActionResult, { ok: false }>["error"] | "too_large" | "file_type";

const ACCEPT = Object.keys(ATTACHMENT_CONTENT_TYPES).join(",");

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toString().replace(".", ",")} MB`;
}

function AttachmentIcon({ contentType }: { contentType: string }) {
  if (contentType === "application/pdf") return <FileTextIcon className="size-4" aria-hidden />;
  if (contentType.startsWith("image/")) return <ImageIcon className="size-4" aria-hidden />;
  return <FileIcon className="size-4" aria-hidden />;
}

export function AttachmentsPanel({
  revisionId,
  attachments,
  operations,
  editable,
}: {
  revisionId: string;
  attachments: ProductAttachment[];
  operations: ProductOperation[];
  editable: boolean;
}) {
  const t = useTranslations("products.attachments");
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<ProductAttachment | null>(null);
  const [, startTransition] = useTransition();

  const visible = showArchived ? attachments : attachments.filter((a) => !a.archived);
  const archivedCount = attachments.filter((a) => a.archived).length;
  const mainDrawings = visible.filter((a) => a.kind === "main_drawing");
  const machineDrawings = (mainId: string) =>
    visible.filter((a) => a.kind === "machine_drawing" && a.mainDrawingId === mainId);
  // Machine drawings whose main drawing is hidden (archived) are listed with the rest.
  const others = visible.filter(
    (a) =>
      a.kind === "image" ||
      a.kind === "other" ||
      (a.kind === "machine_drawing" && !mainDrawings.some((main) => main.id === a.mainDrawingId)),
  );
  const operationLabel = (id: string | null) => {
    const op = operations.find((candidate) => candidate.id === id);
    return op ? `${op.sequence} ${op.type.code}` : null;
  };

  const open = (attachment: ProductAttachment) => {
    // Open the tab synchronously (popup blockers), then point it at the signed URL.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      const result = await getAttachmentUrlAction(attachment.id);
      if (result.ok && tab) {
        tab.opener = null;
        tab.location.href = result.url;
      } else {
        tab?.close();
        toast.error(t(`errors.${result.ok ? "unexpected" : result.error}`));
      }
    });
  };

  const restore = (attachment: ProductAttachment) =>
    startTransition(async () => {
      const result = await setAttachmentArchivedAction(attachment.id, false);
      if (result.ok) toast.success(t("restoredToast", { name: attachment.fileName }));
      else toast.error(t(`errors.${result.error}`));
    });

  const row = (attachment: ProductAttachment, nested = false) => (
    <li
      key={attachment.id}
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${
        nested ? "ml-6" : ""
      } ${attachment.archived ? "opacity-60" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AttachmentIcon contentType={attachment.contentType} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{attachment.title ?? attachment.fileName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {attachment.title ? `${attachment.fileName} · ` : ""}
            {formatSize(attachment.sizeBytes)}
          </span>
        </div>
        <Badge variant="outline">{t(`kinds.${attachment.kind}`)}</Badge>
        {operationLabel(attachment.operationId) ? (
          <Badge variant="secondary">
            {t("forOperation", { operation: operationLabel(attachment.operationId) ?? "" })}
          </Badge>
        ) : null}
        {attachment.archived ? <Badge variant="secondary">{t("archivedBadge")}</Badge> : null}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => open(attachment)}>
          <ExternalLinkIcon />
          {t("open")}
        </Button>
        {editable ? (
          attachment.archived ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("restore", { name: attachment.fileName })}
              onClick={() => restore(attachment)}
            >
              <RotateCcwIcon />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("archive", { name: attachment.fileName })}
              onClick={() => setArchiving(attachment)}
            >
              <ArchiveIcon />
            </Button>
          )
        ) : null}
      </div>
    </li>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        {archivedCount > 0 ? (
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(value) => setShowArchived(value === true)}
            />
            {t("showArchived", { count: archivedCount })}
          </Label>
        ) : null}
        {visible.length === 0 ? (
          <EmptyState
            icon={<PaperclipIcon />}
            title={t("emptyTitle")}
            description={editable ? t("emptyDescription") : t("emptyReadOnlyDescription")}
          />
        ) : (
          <>
            {mainDrawings.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t("sections.drawings")}</h3>
                <ul className="flex flex-col gap-2">
                  {mainDrawings.map((drawing) => (
                    <li key={drawing.id} className="flex flex-col gap-2">
                      <ul className="flex flex-col gap-2">
                        {row(drawing)}
                        {machineDrawings(drawing.id).map((child) => row(child, true))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {others.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t("sections.other")}</h3>
                <ul className="flex flex-col gap-2">
                  {others.map((attachment) => row(attachment))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
      {editable ? (
        <UploadCard
          revisionId={revisionId}
          mainDrawings={attachments.filter((a) => a.kind === "main_drawing" && !a.archived)}
          operations={operations}
        />
      ) : null}
      {editable ? (
        <ConfirmDialog
          open={archiving !== null}
          onOpenChange={(value) => !value && setArchiving(null)}
          title={t("archiveTitle", { name: archiving?.fileName ?? "" })}
          description={t("archiveDescription")}
          confirmLabel={t("archiveConfirm")}
          destructive
          onConfirm={async () => {
            if (!archiving) return;
            const result = await setAttachmentArchivedAction(archiving.id, true);
            if (result.ok) toast.success(t("archivedToast", { name: archiving.fileName }));
            else toast.error(t(`errors.${result.error}`));
          }}
        />
      ) : null}
    </div>
  );
}

function UploadCard({
  revisionId,
  mainDrawings,
  operations,
}: {
  revisionId: string;
  mainDrawings: ProductAttachment[];
  operations: ProductOperation[];
}) {
  const t = useTranslations("products.attachments");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AttachmentKind>(
    mainDrawings.length > 0 ? "machine_drawing" : "main_drawing",
  );
  const [title, setTitle] = useState("");
  const [mainDrawingId, setMainDrawingId] = useState("");
  const selectedMainDrawingId =
    mainDrawings.find((drawing) => drawing.id === mainDrawingId)?.id ?? mainDrawings[0]?.id ?? "";
  const [operationId, setOperationId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [pending, startTransition] = useTransition();
  const kinds = useMemo(
    () =>
      ATTACHMENT_KINDS.filter((value) => value !== "machine_drawing" || mainDrawings.length > 0),
    [mainDrawings.length],
  );

  const upload = () => {
    setError(null);
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) return setError("too_large");
    const meta = {
      revisionId,
      kind,
      title,
      mainDrawingId: kind === "machine_drawing" ? selectedMainDrawingId : "",
      operationId: kind === "machine_drawing" ? operationId : "",
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    };
    const parsed = attachmentMetaSchema.safeParse(meta);
    if (!parsed.success) {
      return setError(
        parsed.error.issues.some((issue) => issue.path[0] === "contentType")
          ? "file_type"
          : "invalid",
      );
    }

    startTransition(async () => {
      const ticket = await prepareAttachmentUploadAction(meta);
      if (!ticket.ok) return setError(ticket.error);

      const supabase = createClient();
      const uploaded = await supabase.storage
        .from(PRODUCT_FILES_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (uploaded.error) {
        console.error("upload failed", uploaded.error);
        return setError("upload_failed");
      }

      const result = await registerAttachmentAction(meta, ticket.path);
      if (!result.ok) return setError(result.error);

      toast.success(t("uploadedToast", { name: file.name }));
      setFile(null);
      setTitle("");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("upload.title")}</CardTitle>
        <CardDescription>{t("upload.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="attachment-kind">{t("upload.kind")}</FieldLabel>
            <NativeSelect
              id="attachment-kind"
              className="w-full"
              value={kind}
              onChange={(event) => {
                const next = ATTACHMENT_KINDS.find((value) => value === event.target.value);
                if (next) setKind(next);
              }}
            >
              {kinds.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`kinds.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {mainDrawings.length === 0 ? (
              <FieldDescription>{t("upload.machineDrawingNeedsMain")}</FieldDescription>
            ) : null}
          </Field>
          {kind === "machine_drawing" ? (
            <>
              <Field>
                <FieldLabel htmlFor="attachment-main">{t("upload.mainDrawing")}</FieldLabel>
                <NativeSelect
                  id="attachment-main"
                  className="w-full"
                  value={selectedMainDrawingId}
                  onChange={(event) => setMainDrawingId(event.target.value)}
                >
                  {mainDrawings.map((drawing) => (
                    <NativeSelectOption key={drawing.id} value={drawing.id}>
                      {drawing.title ?? drawing.fileName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="attachment-operation">{t("upload.operation")}</FieldLabel>
                <NativeSelect
                  id="attachment-operation"
                  className="w-full"
                  value={operationId}
                  onChange={(event) => setOperationId(event.target.value)}
                >
                  <NativeSelectOption value="">{t("upload.operationNone")}</NativeSelectOption>
                  {operations.map((op) => (
                    <NativeSelectOption key={op.id} value={op.id}>
                      {`${op.sequence} ${op.type.code} – ${op.type.name}`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>{t("upload.operationHint")}</FieldDescription>
              </Field>
            </>
          ) : null}
          <Field>
            <FieldLabel htmlFor="attachment-title">{t("upload.titleField")}</FieldLabel>
            <Input
              id="attachment-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field data-invalid={error === "too_large" || error === "file_type" || undefined}>
            <FieldLabel htmlFor="attachment-file">{t("upload.file")}</FieldLabel>
            <Input
              ref={fileInput}
              id="attachment-file"
              type="file"
              accept={ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {error === "too_large" || error === "file_type" ? (
              <FieldError>{t(`errors.${error}`)}</FieldError>
            ) : (
              <FieldDescription>{t("upload.fileHint")}</FieldDescription>
            )}
          </Field>
          <Button onClick={upload} disabled={!file || pending}>
            <UploadIcon />
            {pending ? t("upload.uploading") : t("upload.submit")}
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
