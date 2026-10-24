"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PRODUCT_TABS, type ProductTab } from "@/modules/products/list-params";

/**
 * Detail tabs. Panels are rendered on the server; the active tab is mirrored
 * into ?tab= (without a navigation) so reloads and shared links keep it.
 */
export function ProductTabs({
  initialTab,
  counts,
  basic,
  operations,
  attachments,
  history,
}: {
  initialTab: ProductTab;
  counts: { operations: number; attachments: number };
  basic: ReactNode;
  operations: ReactNode;
  attachments: ReactNode;
  history: ReactNode;
}) {
  const t = useTranslations("products.tabs");
  const [tab, setTab] = useState<ProductTab>(initialTab);
  const panels: Record<ProductTab, ReactNode> = { basic, operations, attachments, history };

  const select = (value: unknown) => {
    const next = PRODUCT_TABS.find((candidate) => candidate === value);
    if (!next) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "basic") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <Tabs value={tab} onValueChange={select}>
      <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
        {PRODUCT_TABS.map((value) => (
          <TabsTrigger key={value} value={value} className="flex-none px-3">
            {t(value)}
            {value === "operations" || value === "attachments" ? (
              <span className="text-xs text-muted-foreground tabular-nums">{counts[value]}</span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {PRODUCT_TABS.map((value) => (
        <TabsContent key={value} value={value} className="pt-2">
          {panels[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
