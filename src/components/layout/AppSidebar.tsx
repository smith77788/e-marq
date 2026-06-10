import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { HandbookSheet } from "@/components/layout/HandbookSheet";
import {
  Activity,
  BarChart2,
  BookOpen,
  Bot,
  Building2,
  Coins,
  Cpu,
  CreditCard,
  Gauge,
  HeartPulse,
  IdCard,
  Inbox,
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
  TrendingUp,
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
  hash?: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  tone?: string;
};

type NavGroup = {
  labelKey: TKey;
  tone?: string;
  items: NavItem[];
};

// ─── OWNER navigation ────────────────────────────────────────────────────────

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
    {
      labelKey: "sb.revenue",
      to: "/dashboard",
      icon: BarChart2,
      exact: true,
      tone: "text-success",
    },
  ],
};

const SALES: NavGroup = {
  labelKey: "sb.sales" as TKey,
  tone: "text-warning/70",
  items: [
    { labelKey: "sb.orders", to: "/brand/orders", icon: ShoppingCart, tone: "text-warning" },
    { labelKey: "sb.customers", to: "/brand/customers", icon: Users, tone: "text-info" },
  ],
};

const CATALOG: NavGroup = {
  labelKey: "sb.catalog" as TKey,
  tone: "text-info/70",
  items: [
    { labelKey: "sb.products", to: "/brand/products", icon: Package, tone: "text-info" },
    { labelKey: "sb.collections", to: "/brand/catalog", icon: Layers, tone: "text-info" },
    { labelKey: "sb.promotions", to: "/brand/promotions", icon: Tag, tone: "text-accent" },
  ],
};

const MARKETING: NavGroup = {
  labelKey: "sb.marketing" as TKey,
  tone: "text-accent/70",
  items: [
    { labelKey: "sb.email" as TKey, to: "/brand/email", icon: Mail, tone: "text-primary" },
    {
      labelKey: "sb.siteBuilder" as TKey,
      to: "/brand/site-builder",
      icon: Wand2,
      tone: "text-accent",
    },
  ],
};

const AI_AGENTS: NavGroup = {
  labelKey: "sb.growth",
  tone: "text-primary/70",
  items: [
    {
      labelKey: "sb.insights",
      to: "/brand/insights",
      icon: Lightbulb,
      tone: "text-warning",
    },
    {
      labelKey: "sb.decisions" as TKey,
      to: "/brand/decisions",
      icon: Inbox,
      tone: "text-info",
    },
    {
      labelKey: "sb.acosLoop",
      to: "/brand/acos-loop",
      icon: TrendingUp,
      tone: "text-primary",
    },
    {
      labelKey: "sb.roi",
      to: "/brand/roi",
      icon: Coins,
      tone: "text-success",
    },
    { labelKey: "sb.agentLibrary", to: "/agents/library", icon: Bot, tone: "text-accent" },
  ],
};

const OWNER_SETTINGS: NavGroup = {
  labelKey: "sb.setup",
  tone: "text-muted-foreground",
  items: [
    { labelKey: "sb.channels", to: "/brand/channels", icon: Plug, tone: "text-primary" },
    {
      labelKey: "sb.integrations" as TKey,
      to: "/brand/integrations",
      icon: Puzzle,
      tone: "text-info",
    },
    { labelKey: "sb.team" as TKey, to: "/brand/team", icon: UsersRound, tone: "text-accent" },
    {
      labelKey: "sb.storeSettings" as TKey,
      to: "/brand/settings",
      icon: Settings,
      tone: "text-primary",
    },
    {
      labelKey: "sb.planBilling" as TKey,
      to: "/brand/billing",
      icon: CreditCard,
      tone: "text-warning",
    },
    {
      labelKey: "sb.profile" as TKey,
      to: "/profile",
      icon: IdCard,
      exact: true,
      tone: "text-primary",
    },
    {
      labelKey: "sb.ingestLogs" as TKey,
      to: "/brand/ingest-logs",
      icon: Activity,
      tone: "text-muted-foreground",
    },
  ],
};

const OWNER_NAV: NavGroup[] = [COCKPIT, SALES, CATALOG, MARKETING, AI_AGENTS, OWNER_SETTINGS];

// ─── ADMIN navigation ─────────────────────────────────────────────────────────

const MONITORING: NavGroup = {
  labelKey: "sb.monitoring" as TKey,
  tone: "text-destructive/70",
  items: [
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
    {
      labelKey: "sb.selfHeal" as TKey,
      to: "/admin/self-heal",
      icon: Sparkles,
      tone: "text-success",
    },
    {
      labelKey: "sb.adminAuditLog" as TKey,
      to: "/admin/audit-log",
      icon: ShieldCheck,
      tone: "text-warning",
    },
    {
      labelKey: "sb.ingestLogs" as TKey,
      to: "/admin/ingest-logs",
      icon: Activity,
      tone: "text-warning",
    },
  ],
};

const MANAGEMENT: NavGroup = {
  labelKey: "sb.management" as TKey,
  tone: "text-info/70",
  items: [
    { labelKey: "sb.allTenants", to: "/admin/tenants", icon: Building2, tone: "text-primary" },
    {
      labelKey: "sb.adminUsers" as TKey,
      to: "/admin/users",
      icon: UsersRound,
      tone: "text-accent",
    },
    {
      labelKey: "sb.adminPermissions" as TKey,
      to: "/admin/permissions",
      icon: ShieldCheck,
      tone: "text-primary",
    },
    { labelKey: "sb.plansCatalog" as TKey, to: "/admin/plans", icon: Coins, tone: "text-warning" },
    {
      labelKey: "sb.topupRequests" as TKey,
      to: "/admin/topup-requests",
      icon: CreditCard,
      tone: "text-success",
    },
  ],
};

const ADMIN_AGENTS: NavGroup = {
  labelKey: "sb.agents",
  tone: "text-accent/70",
  items: [
    {
      labelKey: "sb.adminCommands" as TKey,
      to: "/admin/commands",
      icon: Zap,
      tone: "text-warning",
    },
    {
      labelKey: "sb.adminDecisions" as TKey,
      to: "/admin/decisions",
      icon: Inbox,
      tone: "text-warning",
    },
    { labelKey: "sb.liveRuns", to: "/agents/live", icon: Activity, tone: "text-success" },
    {
      labelKey: "sb.adminOutcomes" as TKey,
      to: "/admin/outcomes",
      icon: TrendingUp,
      tone: "text-success",
    },
    {
      labelKey: "sb.adminAgents" as TKey,
      to: "/admin/agents",
      icon: Bot,
      tone: "text-warning",
    },
    {
      labelKey: "sb.insightStream",
      to: "/admin/overview",
      hash: "stream",
      icon: Radio,
      tone: "text-warning",
    },
    { labelKey: "sb.agentLibrary", to: "/agents/library", icon: Cpu, tone: "text-accent" },
  ],
};

const LEAD_GEN: NavGroup = {
  labelKey: "sb.leadGen" as TKey,
  tone: "text-accent/70",
  items: [
    { labelKey: "sb.leadRadar" as TKey, to: "/admin/lead-radar", icon: Radio, tone: "text-accent" },
    { labelKey: "sb.crossTenant" as TKey, to: "/admin/overview", icon: Layers, tone: "text-info" },
    {
      labelKey: "sb.dntradeHealth" as TKey,
      to: "/admin/dntrade-health",
      icon: HeartPulse,
      tone: "text-destructive",
    },
  ],
};

const ADMIN_NAV: NavGroup[] = [
  MONITORING,
  MANAGEMENT,
  ADMIN_AGENTS,
  LEAD_GEN,
  COCKPIT,
  SALES,
  CATALOG,
  MARKETING,
  AI_AGENTS,
  OWNER_SETTINGS,
];

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  isSuperAdmin: boolean;
  brandName?: string | null;
  tenantSlug?: string | null;
  currentTenantId?: string | null;
};

export function AppSidebar({ isSuperAdmin, brandName, tenantSlug, currentTenantId }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  const groups = isSuperAdmin ? ADMIN_NAV : OWNER_NAV;
  const [handbookOpen, setHandbookOpen] = useState(false);

  const withTenantSearch = currentTenantId ? { tenant: currentTenantId } : undefined;

  const handleHashNav = useCallback(
    (e: React.MouseEvent, to: string, hash: string) => {
      e.preventDefault();
      const scrollTo = () => {
        const el = document.getElementById(hash);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          return true;
        }
        return false;
      };
      const pollScroll = () => {
        let attempts = 0;
        const tick = () => {
          if (scrollTo() || attempts++ > 40) return;
          setTimeout(tick, 50);
        };
        tick();
      };
      if (location.pathname === to || location.pathname.startsWith(to + "/")) {
        pollScroll();
        history.replaceState(null, "", `${to}#${hash}`);
        return;
      }
      void Promise.resolve(navigate({ to, hash, search: withTenantSearch as never })).then(() => {
        requestAnimationFrame(() => requestAnimationFrame(pollScroll));
      });
    },
    [location.pathname, navigate, withTenantSearch],
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
                            href={`${item.to}${currentTenantId ? `?tenant=${currentTenantId}` : ""}#${item.hash}`}
                            onClick={(e) => handleHashNav(e, item.to, item.hash!)}
                            className={linkClasses}
                          >
                            {inner}
                          </a>
                        ) : (
                          <Link to={item.to} search={withTenantSearch} className={linkClasses}>
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
            <SidebarMenuButton
              tooltip={t("sb.handbook")}
              onClick={() => setHandbookOpen(true)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
            >
              <BookOpen className="h-4 w-4 text-info" />
              {!collapsed && <span>{t("sb.handbook")}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("sb.storefront")}>
              {tenantSlug ? (
                <Link
                  to="/s/$slug"
                  params={{ slug: tenantSlug }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                >
                  <ShoppingBag className="h-4 w-4 text-success" />
                  {!collapsed && <span>{t("sb.storefront")}</span>}
                </Link>
              ) : (
                <Link
                  to="/brand"
                  search={withTenantSearch}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                >
                  <ShoppingBag className="h-4 w-4 text-success" />
                  {!collapsed && <span>{t("sb.storefront")}</span>}
                </Link>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <HandbookSheet open={handbookOpen} onOpenChange={setHandbookOpen} />
    </Sidebar>
  );
}
