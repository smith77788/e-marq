import { createFileRoute, Outlet, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading, isSuperAdmin, signOut } = useAuth();
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
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.invalidate();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/dashboard" className="font-semibold text-foreground">
            ACOS
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/dashboard"
              activeProps={{ className: "text-foreground" }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Dashboard
            </Link>
            {isSuperAdmin && (
              <Link
                to="/admin/tenants"
                activeProps={{ className: "text-foreground" }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Tenants
              </Link>
            )}
            <span className="hidden text-xs text-muted-foreground sm:inline">{user.email}</span>
            <Button size="sm" variant="outline" onClick={handleSignOut}>
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
