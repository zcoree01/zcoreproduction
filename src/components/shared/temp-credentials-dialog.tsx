"use client";

import { CheckIcon, CopyIcon, PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type TempCredentialsInfo = {
  username: string;
  password: string;
  fullName: string;
  organizationName: string;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

/**
 * Shows a generated temporary password exactly once (it is never stored
 * readable), with copy and a small printable card to hand to the worker.
 */
export function TempCredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: TempCredentialsInfo | null;
  onClose: () => void;
}) {
  const t = useTranslations("credentials");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(
        `${t("username")}: ${credentials.username}\n${t("password")}: ${credentials.password}`,
      );
      setCopied(true);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const print = () => {
    if (!credentials) return;
    const win = window.open("", "_blank", "width=480,height=360");
    if (!win) {
      toast.error(t("printBlocked"));
      return;
    }
    const row = (label: string, value: string) =>
      `<p><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`;
    win.document.write(`<!doctype html><html lang="bs"><head><meta charset="utf-8">
<title>${escapeHtml(t("cardTitle"))}</title>
<style>
  @page { size: A6 landscape; margin: 10mm; }
  body { font-family: system-ui, sans-serif; color: #000; margin: 0; }
  .card { border: 1px dashed #000; padding: 16px; max-width: 120mm; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .org { font-size: 12px; margin: 0 0 12px; }
  p { display: flex; justify-content: space-between; gap: 16px; margin: 6px 0; font-size: 14px; }
  strong { font-family: ui-monospace, monospace; font-size: 18px; }
  .note { font-size: 11px; margin-top: 12px; }
</style></head><body><div class="card">
<h1>${escapeHtml(credentials.fullName)}</h1>
<p class="org">${escapeHtml(credentials.organizationName)}</p>
${row(t("username"), credentials.username)}
${row(t("password"), credentials.password)}
<div class="note">${escapeHtml(t("cardNote"))}</div>
</div><script>window.onload = () => { window.print(); };</script></body></html>`);
    win.document.close();
  };

  return (
    <AlertDialog
      open={credentials !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {credentials ? (
          <dl className="grid gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{t("username")}</dt>
              <dd className="font-mono text-lg font-semibold" data-testid="temp-username">
                {credentials.username}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{t("password")}</dt>
              <dd className="font-mono text-lg font-semibold" data-testid="temp-password">
                {credentials.password}
              </dd>
            </div>
          </dl>
        ) : null}
        <p className="text-sm text-muted-foreground">{t("onceNote")}</p>
        <AlertDialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t("copied") : t("copy")}
          </Button>
          <Button variant="outline" onClick={print}>
            <PrinterIcon />
            {t("print")}
          </Button>
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            {t("done")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
