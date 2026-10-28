"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** After /support/exit: "Sesija podrške je završena" once, then a clean URL (D-028). */
export function SupportEndedNotice() {
  const t = useTranslations("platform.support");
  const router = useRouter();
  useEffect(() => {
    toast.info(t("endedNotice"), { id: "support-ended" });
    router.replace("/platform");
  }, [t, router]);
  return null;
}
