import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  Activity,
  BookOpen,
  Bot,
  Building2,
  Coins,
  Cpu,
  CreditCard,
  Gauge,
  HeartPulse,
  IdCard,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Mail,
  Package,
  Plug,
  Puzzle,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  Users,
  UsersRound,
  Wand2,
  Zap,
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
  /** Optional hash anchor (`#section`) appended to the link href. */
  hash?: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  /** Tailwind text-color class for the icon when inactive (group accent). */
  tone?: string;
};

type NavGroup = {
  labelKey: TKey;
  /** Tailwind text-color class for the group label (subtle accent). */
  tone?: string;
  items: NavItem[];
};

const COCKPIT: NavGroup = {
  labelKey: "sb.cockpit",
  tone: "text-primary/70",
  items: [
    {
      labelKey: "sb.overview",
      to: "/brand",
      icon: LayoutDashboard,
      exact: true,
      tone: "text-primary",
    },
    { labelKey: "sb.revenue", to: "/dashboard", icon: Gauge, exact: true, tone: "text-success" },
  ],
};

const SHOP: NavGroup = {
  labelKey: "sb.shop",
  tone: "text-info/70",
  items: [
    { labelKey: "sb.products", to: "/brand/products", icon: Package, tone: "text-info" },
    { labelKey: "sb.orders", to: "/brand/orders", icon: ShoppingCart, tone: "text-warning" },
    { labelKey: "sb.collections", to: "/brand/catalog", icon: Layers, tone: "text-info" },
    { labelKey: "sb.promotions", to: "/brand/promotions", icon: Tag, tone: "text-accent" },
    { labelKey: "sb.email" as TKey, to: "/brand/email", icon: Mail, tone: "text-primary" },
    {
      labelKey: "sb.siteBuilder" as TKey,
      to: "/brand/site-builder",
      icon: Wand2,
      tone: "text-accent",
    },
    {
      labelKey: "sb.storeSettings" as TKey,
      to: "/brand/settings",
      icon: Settings,
      tone: "text-primary",
    },
  ],
};

const GROWTH: NavGroup = {
  labelKey: "sb.growth",
  tone: "text-accent/70",
  items: [
    {
      labelKey: "sb.insights",
      to: "/brand",
      hash: "insights",
      icon: Lightbulb,
      tone: "text-warning",
    },
    { labelKey: "sb.customers", to: "/brand", hash: "customers", icon: Users, tone: "text-info" },
    { labelKey: "sb.agents", to: "/agents/library", icon: Bot, tone: "text-accent" },
  ],
};

const SETUP: NavGroup = {
  labelKey: "sb.setup",
  tone: "text-muted-foreground",
  items: [
    { labelKey: "sb.channels", to: "/brand", hash: "channels", icon: Plug, tone: "text-primary" },
    {
      labelKey: "sb.integrations" as TKey,
      to: "/brand/integrations",
      icon: Puzzle,
      tone: "text-info",
    },
    { labelKey: "sb.onboarding", to: "/onboarding", icon: Sparkles, tone: "text-accent" },
    {
      labelKey: "sb.profile" as TKey,
      to: "/profile",
      icon: IdCard,
      exact: true,
      tone: "text-primary",
    },
  ],
};

const BILLING: NavGroup = {
  labelKey: "sb.billing" as TKey,
  tone: "text-warning/70",
  items: [
    {
      labelKey: "sb.planBilling" as TKey,
      to: "/brand/billing",
      icon: CreditCard,
      tone: "text-warning",
    },
  ],
};

const OWNER_NAV: NavGroup[] = [COCKPIT, SHOP, GROWTH, SETUP, BILLING];

const ADMIN_SYSTEM: NavGroup = {
  labelKey: "sb.system",
  tone: "text-destructive/70",
  items: [
    {
      labelKey: "sb.adminCommands" as TKey,
      to: "/admin/commands",
      icon: Zap,
      tone: "text-warning",
    },
    {
      labelKey: "sb.missionControl",
      to: "/admin",
      icon: ShieldCheck,
      exact: true,
      tone: "text-destructive",
    },
    {
      labelKey: "sb.healthMonitor" as TKey,
      to: "/admin/health",
      icon: HeartPulse,
      tone: "text-destructive",
    },
    { labelKey: "sb.crossTenant" as TKey, to: "/admin/overview", icon: Layers, tone: "text-info" },
    { labelKey: "sb.allTenants", to: "/admin/tenants", icon: Building2, tone: "text-primary" },
    { labelKey: "sb.plansCatalog" as TKey, to: "/admin/plans", icon: Coins, tone: "text-warning" },
    {
      labelKey: "sb.adminUsers" as TKey,
      to: "/admin/users",
      icon: UsersRound,
      tone: "text-accent",
    },
    {
      labelKey: "sb.topupRequests" as TKey,
      to: "/admin/topup-requests",
      icon: CreditCard,
      tone: "text-success",
    },
    { labelKey: "sb.leadRadar" as TKey, to: "/admin/lead-radar", icon: Radio, tone: "text-accent" },
    {
      labelKey: "sb.dntradeHealth" as TKey,
      to: "/admin/dntrade-health",
      icon: HeartPulse,
      tone: "text-destructive",
    },
  ],
};

const ADMIN_AGENTS: NavGroup = {
  labelKey: "sb.agents",
  tone: "text-accent/70",
  items: [
    { labelKey: "sb.liveRuns", to: "/agents/live", icon: Activity, tone: "text-success" },
    { labelKey: "sb.agentLibrary", to: "/agents/library", icon: Cpu, tone: "text-accent" },
    { labelKey: "sb.insightStream", to: "/admin/overview", icon: Radio, tone: "text-warning" },
  ],
};

// Адмін бачить системні розділи + повний доступ до всіх бренд-розділів,
// щоб міг керувати магазином обраного бренду без перемикань ролей.
const ADMIN_NAV: NavGroup[] = [ADMIN_SYSTEM, ADMIN_AGENTS, COCKPIT, SHOP, GROWTH, SETUP, BILLING];

type Props = {
  isSuperAdmin: boolean;
  brandName?: string | null;
};

export function AppSidebar({ isSuperAdmin, brandName }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  const groups = isSuperAdmin ? ADMIN_NAV : OWNER_NAV;

  /**
   * Smart hash navigation:
   * - If we're already on the target route, smooth-scroll to the anchor.
   * - Otherwise, navigate via TanStack router (no full reload) and after
   *   the route mounts scroll to the anchor.
   */
  const handleHashNav = useCallback(
    (e: React.MouseEvent, to: string, hash: string) => {
      e.preventDefault();
      const scrollTo = () => {
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      };
      if (location.pathname === to || location.pathname.startsWith(to + "/")) {
        scrollTo();
        history.replaceState(null, "", `${to}#${hash}`);
        return;
      }
      void navigate({ to, hash }).then(() => {
        // wait one frame for the new route to mount its sections
        requestAnimationFrame(() => requestAnimationFrame(scrollTo));
      });
    },
    [location.pathname, navigate],
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          to={isSuperAdmin ? "/admin" : "/brand"}
          className="flex items-center gap-2 px-2 py-1.5 transition-opacity hover:opacity-90"
        >
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Bot className="h-4 w-4 text-primary-foreground" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-sidebar animate-pulse" />
          </span>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                MARQ
              </span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {isSuperAdmin ? t("sb.missionControl") : (brandName ?? t("sb.cockpit"))}
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, gi) => (
          <SidebarGroup
            key={`${group.labelKey}-${gi}`}
            className={cn(gi > 0 && "mt-1 border-t border-sidebar-border/60 pt-2")}
          >
            <SidebarGroupLabel
              className={cn(
                "text-[10px] uppercase tracking-[0.2em]",
                group.tone ?? "text-muted-foreground",
              )}
            >
              {t(group.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.hash
                    ? location.pathname === item.to && location.hash === `#${item.hash}`
                    : item.exact
                      ? location.pathname === item.to
                      : location.pathname === item.to ||
                        location.pathname.startsWith(item.to + "/");
                  const label = t(item.labelKey);
                  const key = `${group.labelKey}-${item.labelKey}-${item.to}-${item.hash ?? ""}`;
                  const iconClasses = cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive
                      ? "text-primary"
                      : cn(
                          item.tone ?? "text-muted-foreground",
                          "opacity-80 group-hover/nav:opacity-100",
                        ),
                  );
                  const linkClasses = cn(
                    "group/nav relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-glow"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  );
                  const inner = (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
                      )}
                      <item.icon className={iconClasses} />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </>
                  );
                  return (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton asChild tooltip={label}>
                        {item.hash ? (
                          <a
                            href={`${item.to}#${item.hash}`}
                            onClick={(e) => handleHashNav(e, item.to, item.hash!)}
                            className={linkClasses}
                          >
                            {inner}
                          </a>
                        ) : (
                          <Link to={item.to} className={linkClasses}>
                            {inner}
                          </Link>
                        )}
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
                <BookOpen className="h-4 w-4 text-info" />
                {!collapsed && <span>{t("sb.handbook")}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("sb.storefront")}>
              <Link
                to="/brand"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <ShoppingBag className="h-4 w-4 text-success" />
                {!collapsed && <span>{t("sb.storefront")}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("sb.settings")}>
              <Link
                to={isSuperAdmin ? "/admin" : "/brand/settings"}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <Settings className="h-4 w-4 text-accent" />
                {!collapsed && <span>{t("sb.settings")}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
