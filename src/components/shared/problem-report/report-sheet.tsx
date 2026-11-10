"use client";

import {
  CreditCardIcon,
  EllipsisIcon,
  ImagePlusIcon,
  LightbulbIcon,
  CircleHelpIcon,
  TimerIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  prepareProblemReportUploadAction,
  registerProblemReportFileAction,
  submitProblemReportAction,
} from "@/modules/support/problem-reports/actions";
import {
  MAX_DESCRIPTION,
  MAX_SCREENSHOT_BYTES,
  PROBLEM_CATEGORIES,
  PROBLEM_REPORT_BUCKET,
  SCREENSHOT_TYPES,
  type ProblemCategory,
} from "@/modules/support/problem-reports/schemas";

const UPLOAD_TIMEOUT_MS = 30_000;

const ICONS: Record<ProblemCategory, LucideIcon> = {
  broken: TriangleAlertIcon,
  slow: TimerIcon,
  howto: CircleHelpIcon,
  idea: LightbulbIcon,
  billing: CreditCardIcon,
  other: EllipsisIcon,
};

/** Values of the form; kept by the parent until the report is sent. */
export type ReportDraft = {
  category: ProblemCategory | null;
  description: string;
  file: File | null;
  /** Created with the form and kept until success: a resend never makes a second report. */
  idempotencyKey: string;
};

export const newReportDraft = (): ReportDraft => ({
  category: null,
  description: "",
  file: null,
  idempotencyKey: crypto.randomUUID(),
});

function isScreenshotType(value: string): value is (typeof SCREENSHOT_TYPES)[number] {
  return (SCREENSHOT_TYPES as readonly string[]).includes(value);
}

/**
 * "Prijavi problem": category, optional text, one screenshot. The page
 * (without query string) and the device go along. On a lost connection the
 * values and the idempotency key stay, so pressing "Pošalji" again is safe.
 */
export function ReportSheet({
  draft,
  onChange,
  onSent,
}: {
  draft: ReportDraft;
  onChange: (draft: ReportDraft) => void;
  onSent: () => void;
}) {
  const t = useTranslations("problemReports");
  const pathname = usePathname();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ category?: string; description?: string; file?: string }>(
    {},
  );

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!isScreenshotType(file.type)) {
      setErrors((current) => ({ ...current, file: t("errors.fileType") }));
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setErrors((current) => ({ ...current, file: t("errors.fileSize") }));
      return;
    }
    setErrors((current) => ({ ...current, file: undefined }));
    onChange({ ...draft, file });
  };

  /** Screenshot after the report exists; false when any step failed. */
  const uploadFile = async (
    reportId: string,
    file: File,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (!isScreenshotType(file.type)) return false;
    try {
      const ticket = await prepareProblemReportUploadAction({
        reportId,
        contentType: file.type,
        size: file.size,
      });
      if (signal.aborted || !ticket.ok) return false;
      const uploaded = await createClient()
        .storage.from(PROBLEM_REPORT_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (signal.aborted || uploaded.error) return false;
      const registered = await registerProblemReportFileAction(reportId, ticket.path);
      return !signal.aborted && registered.ok;
    } catch {
      return false;
    }
  };

  /**
   * The report already exists; the screenshot follows in the background so a
   * slow network never keeps the sheet on "Šaljem…". After 30 s a late result
   * is ignored. Never throws, also when the sheet is gone by then.
   */
  const uploadInBackground = (reportId: string, file: File) => {
    const controller = new AbortController();
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        controller.abort();
        resolve(false);
      }, UPLOAD_TIMEOUT_MS);
    });
    void Promise.race([uploadFile(reportId, file, controller.signal), timeout])
      .then((ok) => {
        if (!ok) toast.warning(t("errors.fileFailed"));
      })
      .catch(() => toast.warning(t("errors.fileFailed")));
  };

  const send = async () => {
    const next: typeof errors = {};
    if (draft.category === null) next.category = t("errors.category");
    if (draft.category === "other" && draft.description.trim() === "") {
      next.description = t("errors.descriptionRequired");
    }
    setErrors(next);
    if (draft.category === null || next.description) return;

    setPending(true);
    try {
      let result: Awaited<ReturnType<typeof submitProblemReportAction>>;
      try {
        result = await submitProblemReportAction({
          category: draft.category,
          description: draft.description,
          pagePath: pathname,
          userAgent: navigator.userAgent.slice(0, 500),
          idempotencyKey: draft.idempotencyKey,
        });
      } catch {
        // Offline: values and key stay for the next try.
        toast.error(t("errors.offline"));
        return;
      }
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("sent"));
      const file = draft.file;
      onChange(newReportDraft());
      setErrors({});
      onSent();
      if (file) uploadInBackground(result.id, file);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id="report-category-label">
          {t("categoryLabel")}
        </p>
        <div
          className="grid grid-cols-2 gap-2"
          role="group"
          aria-labelledby="report-category-label"
        >
          {PROBLEM_CATEGORIES.map((category) => {
            const Icon = ICONS[category];
            const selected = draft.category === category;
            return (
              <Button
                key={category}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                disabled={pending}
                className="h-14 justify-start gap-2 px-3 text-left whitespace-normal"
                onClick={() => {
                  setErrors((current) => ({ ...current, category: undefined }));
                  onChange({ ...draft, category });
                }}
              >
                <Icon className="size-5 shrink-0" />
                {t(`categories.${category}`)}
              </Button>
            );
          })}
        </div>
        {errors.category ? <FieldError>{errors.category}</FieldError> : null}
      </div>

      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="report-description">{t("descriptionLabel")}</FieldLabel>
        <Textarea
          id="report-description"
          rows={5}
          maxLength={MAX_DESCRIPTION}
          value={draft.description}
          placeholder={t("descriptionPlaceholder")}
          disabled={pending}
          aria-invalid={errors.description ? true : undefined}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
        {errors.description ? <FieldError>{errors.description}</FieldError> : null}
      </Field>

      <div className="flex flex-col gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={SCREENSHOT_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label={t("screenshotInput")}
          onChange={(event) => {
            pickFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {draft.file ? (
          <div className="flex items-center gap-2 rounded-lg border p-2 text-sm">
            <ImagePlusIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{draft.file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={t("removeScreenshot")}
              onClick={() => onChange({ ...draft, file: null })}
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className={cn("h-12 justify-start gap-2")}
            disabled={pending}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlusIcon />
            {t("addScreenshot")}
          </Button>
        )}
        {errors.file ? <FieldError>{errors.file}</FieldError> : null}
        <p className="text-xs text-muted-foreground">{t("context")}</p>
      </div>

      <Button type="button" size="lg" className="h-12 text-base" disabled={pending} onClick={send}>
        {pending ? t("sending") : t("send")}
      </Button>
    </div>
  );
}
