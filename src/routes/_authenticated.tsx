import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LanguageSwitcher } from "@/components/owner/LanguageSwitcher";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LiveStatus } from "@/components/layout/LiveStatus";
import { InsightToasts } from "@/components/layout/InsightToasts";
import { NotificationCenter } from "@/components/layout/NotificationCenter";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { TenantSwitcher } from "@/components/layout/TenantSwitcher";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { RecentPagesTracker } from "@/components/layout/RecentPagesTracker";
import { MfaChallengeGate } from "@/components/layout/MfaChallengeGate";
import { TenantContextProvider, useTenantContext } from "@/hooks/useTenantContext";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading, isSuperAdmin, signOut } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      void navigate({ to: "/login" });
    }
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="pulse-dot" /> {t("hdr.booting")}
        </div>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.invalidate();
    navigate({ to: "/login" });
  }

  return (
    <MfaChallengeGate>
      <TenantContextProvider>
        <AuthenticatedShell
          userEmail={user.email ?? ""}
          isSuperAdmin={isSuperAdmin}
          onSignOut={handleSignOut}
        />
      </TenantContextProvider>
    </MfaChallengeGate>
  );
}

function AuthenticatedShell({
  userEmail,
  isSuperAdmin,
  onSignOut,
}: {
  userEmail: string;
  isSuperAdmin: boolean;
  onSignOut: () => void;
}) {
  const { t } = useT();
  const { current } = useTenantContext();

  return (
    <SidebarProvider defaultOpen>
      {/*
        Skip-to-content link — visually hidden until focused via Tab. Lets
        keyboard / screen-reader users jump straight to <main> without tabbing
        through the entire sidebar + header.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t("a11y.skipToContent")}
      </a>
      <AppSidebar
        isSuperAdmin={isSuperAdmin}
        brandName={current?.tenant_name}
        tenantSlug={current?.tenant_slug ?? null}
      />
      <SidebarInset className="bg-background">
        <header
          role="banner"
          className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
          <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
          <div className="hidden items-center gap-2 sm:flex">
            <LiveStatus />
            {isSuperAdmin && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                {t("hdr.superAdmin")}
              </span>
            )}
          </div>
          <div className="ml-2 min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch />
            <TenantSwitcher />
            <NotificationCenter />
            <LanguageSwitcher />
            <ThemeToggle />
            <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground md:inline">
              {userEmail}
            </span>
            <Button size="sm" variant="outline" onClick={onSignOut}>
              {t("nav.signout")}
            </Button>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          aria-label={t("a11y.mainContent")}
          className="min-h-[calc(100vh-3.5rem)] px-4 py-6 sm:px-6 sm:py-8 focus:outline-none"
        >
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
        <InsightToasts />
        <RecentPagesTracker />
      </SidebarInset>
    </SidebarProvider>
  );
}
