"use client";

import { ChevronDownIcon, MailIcon, Share2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mailLink, type MailDraft, type MailTarget } from "@/modules/finished-goods/mail";

const WEB_TARGETS: MailTarget[] = ["gmail", "outlook", "outlook_work"];

/**
 * "Pošalji mailom" (D-040), without connecting an account: the share sheet
 * of the phone / tablet / Windows opens Gmail or Outlook with the PDF
 * attached; on a computer Gmail / Outlook / the mail program open with the
 * recipient, subject and text filled in while the PDF is downloaded to be
 * dragged into the e-mail.
 */
export function SendNoteMenu({
  noteId,
  fileName,
  draft,
}: {
  noteId: string;
  fileName: string;
  draft: MailDraft;
}) {
  const t = useTranslations("finishedGoods.send");
  const pdfUrl = `/inventory/delivery-notes/${noteId}/pdf`;
  const file = useRef<File | null>(null);
  const [canShare, setCanShare] = useState(false);

  // Loaded when the menu opens, so sharing can start right on the click
  // (browsers allow the share sheet only directly after a tap).
  const prepare = async () => {
    if (file.current || typeof navigator.canShare !== "function") return;
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) return;
      const pdf = new File([await response.blob()], fileName, { type: "application/pdf" });
      if (navigator.canShare({ files: [pdf] })) {
        file.current = pdf;
        setCanShare(true);
      }
    } catch {
      // No share sheet; the other options still work.
    }
  };

  const share = async () => {
    if (!file.current) return;
    try {
      await navigator.share({
        files: [file.current],
        title: draft.subject,
        text: draft.body,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(t("shareFailed"));
    }
  };

  const download = () => {
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  };

  const open = (target: MailTarget) => {
    download();
    const url = mailLink(target, draft);
    if (target === "mail_app") window.location.assign(url);
    else window.open(url, "_blank", "noopener");
    toast.info(t("attachHint", { file: fileName }), { duration: 10_000 });
  };

  return (
    <DropdownMenu onOpenChange={(isOpen) => (isOpen ? void prepare() : undefined)}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <MailIcon />
        {t("button")}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {canShare ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void share()}>
                <Share2Icon />
                <span className="flex flex-col">
                  <span>{t("share")}</span>
                  <span className="text-xs text-muted-foreground">{t("shareHint")}</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("openIn")}</DropdownMenuLabel>
          {WEB_TARGETS.map((target) => (
            <DropdownMenuItem key={target} onClick={() => open(target)}>
              {t(`targets.${target}`)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => open("mail_app")}>
            {t("targets.mail_app")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href={pdfUrl} download={fileName} />}>
          {t("downloadPdf")}
        </DropdownMenuItem>
        {draft.to ? null : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("noEmail")}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
