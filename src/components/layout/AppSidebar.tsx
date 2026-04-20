import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  Bot,
  Building2,
  Cpu,
  Gauge,
  LayoutDashboard,
  Lightbulb,
  Plug,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
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

type NavItem = {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const OWNER_NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Cockpit",
    items: [
      { label: "Overview", to: "/brand", icon: LayoutDashboard },
      { label: "Revenue", to: "/dashboard", icon: Gauge },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Insights", to: "/brand", icon: Lightbulb },
      { label: "Customers", to: "/brand", icon: Users },
      { label: "Agents", to: "/agents", icon: Bot },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Channels", to: "/brand", icon: Plug },
      { label: "Onboarding", to: "/onboarding", icon: Sparkles },
    ],
  },
];

const ADMIN_NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "System",
    items: [
      { label: "Mission Control", to: "/admin", icon: ShieldCheck, exact: true },
      { label: "All Tenants", to: "/admin/tenants", icon: Building2 },
    ],
  },
  {
    label: "Agents",
    items: [
      { label: "Live Runs", to: "/agents", icon: Activity },
      { label: "Agent Library", to: "/agents", icon: Cpu },
      { label: "Insight Stream", to: "/admin", icon: Radio },
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
  const groups = isSuperAdmin ? ADMIN_NAV : OWNER_NAV;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          to={isSuperAdmin ? "/admin/tenants" : "/brand"}
          className="flex items-center gap-2 px-2 py-1.5"
        >
          <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <Bot className="h-4 w-4 text-primary-foreground" />
          </span>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">ACOS</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {isSuperAdmin ? "Mission Control" : brandName ?? "Cockpit"}
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.exact
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={`${group.label}-${item.label}`}>
                      <SidebarMenuButton asChild tooltip={item.label}>
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
                          {!collapsed && <span className="truncate">{item.label}</span>}
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
            <SidebarMenuButton asChild tooltip="Storefront">
              <Link
                to="/dashboard"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                {!collapsed && <span>Storefront</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Settings">
              <Link
                to="/onboarding"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {!collapsed && <span>Settings</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
