"use client";

import { PrinterIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("orders.print");
  return (
    <Button onClick={() => window.print()}>
      <PrinterIcon />
      {t("print")}
    </Button>
  );
}
