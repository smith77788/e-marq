import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  Bot,
  Building2,
  Coins,
  Cpu,
  CreditCard,
  Gauge,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Plug,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Terminal,
  Users,
  UsersRound,
} from "lucide-react";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useT, type TKey } from "@/lib/i18n";

type NavItem = {
  labelKey: TKey;
  to: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const OWNER_NAV: { labelKey: TKey; items: NavItem[] }[] = [
  {
    labelKey: "sb.cockpit",
    items: [
      { labelKey: "sb.overview", to: "/brand", icon: LayoutDashboard },
      { labelKey: "sb.revenue", to: "/dashboard", icon: Gauge },
    ],
  },
  {
    labelKey: "sb.growth",
    items: [
      { labelKey: "sb.insights", to: "/brand", icon: Lightbulb },
      { labelKey: "sb.customers", to: "/brand", icon: Users },
      { labelKey: "sb.agents", to: "/agents", icon: Bot },
    ],
  },
  {
    labelKey: "sb.setup",
    items: [
      { labelKey: "sb.channels", to: "/brand", icon: Plug },
      { labelKey: "sb.onboarding", to: "/onboarding", icon: Sparkles },
    ],
  },
  {
    labelKey: "sb.billing" as TKey,
    items: [
      { labelKey: "sb.planBilling" as TKey, to: "/brand/billing", icon: CreditCard },
    ],
  },
];

const ADMIN_NAV: { labelKey: TKey; items: NavItem[] }[] = [
  {
    labelKey: "sb.system",
    items: [
      { labelKey: "sb.missionControl", to: "/admin", icon: ShieldCheck, exact: true },
      { labelKey: "sb.crossTenant" as TKey, to: "/admin/overview", icon: Layers },
      { labelKey: "sb.allTenants", to: "/admin/tenants", icon: Building2 },
      { labelKey: "sb.plansCatalog" as TKey, to: "/admin/plans", icon: Coins },
      { labelKey: "sb.adminUsers" as TKey, to: "/admin/users", icon: UsersRound },
    ],
  },
  {
    labelKey: "sb.agents",
    items: [
      { labelKey: "sb.adminCommands" as TKey, to: "/admin/commands", icon: Terminal },
      { labelKey: "sb.liveRuns", to: "/agents/live", icon: Activity },
      { labelKey: "sb.agentLibrary", to: "/agents", icon: Cpu, exact: true },
      { labelKey: "sb.insightStream", to: "/admin", icon: Radio },
    ],
  },
];

type Props = {
  isSuperAdmin: boolean;
  brandName?: string | null;
};

export function AppSidebar({ isSuperAdmin, brandName }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { t } = useT();
  const groups = isSuperAdmin ? ADMIN_NAV : OWNER_NAV;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          to={isSuperAdmin ? "/admin" : "/brand"}
          className="flex items-center gap-2 px-2 py-1.5"
        >
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </span>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">MARQ</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {isSuperAdmin ? t("sb.missionControl") : brandName ?? t("sb.cockpit")}
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t(group.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.exact
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
                  const label = t(item.labelKey);
                  return (
                    <SidebarMenuItem key={`${group.labelKey}-${item.labelKey}`}>
                      <SidebarMenuButton asChild tooltip={label}>
                        <Link
                          to={item.to}
                          className={cn(
                            "group/nav flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-glow"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "h-4 w-4 shrink-0 transition-colors",
                              isActive ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground",
                            )}
                          />
                          {!collapsed && <span className="truncate">{label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("sb.handbook")}>
              <Link
                to="/handbook"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                {!collapsed && <span>{t("sb.handbook")}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("sb.storefront")}>
              <Link
                to="/dashboard"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                {!collapsed && <span>{t("sb.storefront")}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("sb.settings")}>
              <Link
                to="/onboarding"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {!collapsed && <span>{t("sb.settings")}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
