"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ModeToggle } from "@/components/shared/mode-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { activeNavItem } from "@/lib/navigation/registry";
import type { NavGroup } from "@/lib/navigation/server";

// Based on the shadcn dashboard-01 SiteHeader.
export function SiteHeader({
  organizationName,
  groups,
  actions,
}: {
  organizationName: string;
  groups: NavGroup[];
  /** Extra buttons before the theme switch (e.g. notifications). */
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const active = activeNavItem(
    groups.flatMap((group) => group.items),
    pathname,
  );

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">{organizationName}</BreadcrumbItem>
            {active ? (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{active.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-1">
          {actions}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
