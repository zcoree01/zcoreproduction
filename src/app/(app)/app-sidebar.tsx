"use client";

import { FactoryIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { NavIcon } from "@/components/shared/nav-icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { activeNavItem } from "@/lib/navigation/registry";
import type { NavGroup } from "@/lib/navigation/server";
import { NavUser, type NavUserInfo } from "./nav-user";

// Based on the shadcn dashboard-01 block (inset sidebar), fed with real
// navigation filtered by org_modules and permissions.
export function AppSidebar({
  organizationName,
  groups,
  user,
  ...props
}: ComponentProps<typeof Sidebar> & {
  organizationName: string;
  groups: NavGroup[];
  user: NavUserInfo;
}) {
  const pathname = usePathname();
  const active = activeNavItem(
    groups.flatMap((group) => group.items),
    pathname,
  );

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FactoryIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{organizationName}</span>
                <span className="truncate text-xs text-muted-foreground">Zcore Production</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={active?.id === item.id}
                      render={
                        <Link
                          href={item.href}
                          aria-current={active?.id === item.id ? "page" : undefined}
                        />
                      }
                    >
                      <NavIcon icon={item.icon} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
