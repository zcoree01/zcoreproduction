import { createClient } from "@/lib/supabase/client";
import {
  prepareAttachmentUploadAction,
  registerAttachmentAction,
} from "@/modules/products/actions";
import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  attachmentMetaSchema,
  PRODUCT_FILES_BUCKET,
  type AttachmentActionResult,
  type AttachmentKind,
} from "@/modules/products/schemas";

/** accept attribute for file inputs. */
export const ACCEPT_ATTACHMENTS = Object.keys(ATTACHMENT_CONTENT_TYPES).join(",");

export type UploadError =
  Extract<AttachmentActionResult, { ok: false }>["error"] | "too_large" | "file_type";

export type UploadRequest = {
  revisionId: string;
  kind: AttachmentKind;
  title: string;
  mainDrawingId: string;
  operationId: string;
  file: File;
};

/**
 * Uploads one file: the server issues a signed URL for a path it chooses, the
 * browser uploads directly to Storage, the server records the attachment.
 */
export async function uploadAttachment(
  request: UploadRequest,
): Promise<{ ok: true } | { ok: false; error: UploadError }> {
  const { file } = request;
  if (file.size > ATTACHMENT_MAX_BYTES) return { ok: false, error: "too_large" };
  const meta = {
    revisionId: request.revisionId,
    kind: request.kind,
    title: request.title,
    mainDrawingId: request.kind === "machine_drawing" ? request.mainDrawingId : "",
    operationId: request.kind === "machine_drawing" ? request.operationId : "",
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  };
  const parsed = attachmentMetaSchema.safeParse(meta);
  if (!parsed.success) {
    const typeIssue = parsed.error.issues.some((issue) => issue.path[0] === "contentType");
    return { ok: false, error: typeIssue ? "file_type" : "invalid" };
  }

  const ticket = await prepareAttachmentUploadAction(meta);
  if (!ticket.ok) return { ok: false, error: ticket.error };

  const supabase = createClient();
  const uploaded = await supabase.storage
    .from(PRODUCT_FILES_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (uploaded.error) {
    console.error("upload failed", uploaded.error);
    return { ok: false, error: "upload_failed" };
  }

  const result = await registerAttachmentAction(meta, ticket.path);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
