"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ORDER_TABS, type OrderTab } from "@/modules/production-orders/list-params";

/**
 * Detail tabs. Panels are rendered on the server; the active tab is mirrored
 * into ?tab= (without a navigation) so reloads and shared links keep it.
 */
export function OrderTabs({
  initialTab,
  counts,
  panels,
}: {
  initialTab: OrderTab;
  counts: { operations: number; production: number; attachments: number };
  panels: Record<OrderTab, ReactNode>;
}) {
  const t = useTranslations("orders.tabs");
  const [tab, setTab] = useState<OrderTab>(initialTab);

  const select = (value: unknown) => {
    const next = ORDER_TABS.find((candidate) => candidate === value);
    if (!next) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <Tabs value={tab} onValueChange={select}>
      <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
        {ORDER_TABS.map((value) => (
          <TabsTrigger key={value} value={value} className="flex-none px-3">
            {t(value)}
            {value === "operations" || value === "production" || value === "attachments" ? (
              <span className="text-xs text-muted-foreground tabular-nums">{counts[value]}</span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {ORDER_TABS.map((value) => (
        <TabsContent key={value} value={value} className="pt-2">
          {panels[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
