"use client";

import { ExternalLinkIcon, FileIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition, type ComponentProps } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getOrderFileUrlAction } from "@/modules/production-orders/actions";

export function FileTypeIcon({ contentType }: { contentType: string }) {
  if (contentType === "application/pdf") return <FileTextIcon className="size-4" aria-hidden />;
  if (contentType.startsWith("image/")) return <ImageIcon className="size-4" aria-hidden />;
  return <FileIcon className="size-4" aria-hidden />;
}

/** Opens a drawing of an order in a new tab (5-minute signed URL). */
export function OpenOrderFileButton({
  attachmentId,
  label,
  ...props
}: { attachmentId: string; label: string } & Omit<ComponentProps<typeof Button>, "onClick">) {
  const t = useTranslations("orders.attachments");
  const [pending, startTransition] = useTransition();

  const open = () => {
    // Open the tab synchronously (popup blockers), then point it at the signed URL.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      const result = await getOrderFileUrlAction(attachmentId);
      if (result.ok && tab) {
        tab.location.href = result.url;
      } else {
        tab?.close();
        toast.error(t("openFailed"));
      }
    });
  };

  return (
    <Button variant="outline" {...props} disabled={pending || props.disabled} onClick={open}>
      <ExternalLinkIcon />
      {label}
    </Button>
  );
}
