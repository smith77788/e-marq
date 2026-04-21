/**
 * Accept tenant invitation by token.
 * URL: /invite/<token> — user must be logged in with the invited email.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/invite/$token")({
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"pending" | "success" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("accept_tenant_invitation", { _token: token });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setState("error");
        return;
      }
      const result = data as { tenant_id?: string } | null;
      setTenantId(result?.tenant_id ?? null);
      setState("success");
    })();
    return () => { cancelled = true; };
  }, [token, user]);

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === "pending" && <Loader2 className="h-5 w-5 animate-spin" />}
            {state === "success" && <CheckCircle2 className="h-5 w-5 text-success" />}
            {state === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {state === "pending" && "Accepting invitation…"}
            {state === "success" && "Welcome aboard!"}
            {state === "error" && "Invitation problem"}
          </CardTitle>
          <CardDescription>
            {state === "pending" && "Linking your account to the brand."}
            {state === "success" && "You now have access to this brand."}
            {state === "error" && error}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {state === "success" && tenantId && (
            <Button onClick={() => navigate({ to: "/brand", search: { tenant: tenantId } })}>
              Open dashboard
            </Button>
          )}
          {state === "error" && (
            <Button asChild variant="outline">
              <Link to="/brand">Go to dashboard</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
