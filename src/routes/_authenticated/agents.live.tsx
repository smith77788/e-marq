import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AcosAgentRuns } from "@/components/admin/AcosAgentRuns";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useT, tStatic } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/agents/live")({
  head: () => ({
    meta: [
      { title: tStatic("ag.liveTitle") },
      { name: "description", content: tStatic("ag.liveDesc") },
    ],
  }),
  component: AgentsLivePage,
});

function AgentsLivePage() {
  const { current, loading } = useTenantContext();
  const { t } = useT();
  const [running, setRunning] = useState(false);

  const tenantId = current?.tenant_id ?? null;

  async function runAll() {
    if (!tenantId) return;
    setRunning(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("not signed in");
      const res = await fetch("/hooks/agents/run-all", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; insights_created?: number };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success(`${t("ag.liveTriggered")} (+${json.insights_created ?? 0})`);
    } catch (e) {
      toast.error(`${t("ag.liveFailed")} ${e instanceof Error ? e.message : ""}`);
      console.error(e);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
            <Activity className="mr-1 h-3 w-3" /> {t("ag.liveBadge")}
          </Badge>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("ag.liveTitle")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("ag.liveDesc")}
          </p>
        </div>
        <Button onClick={runAll} disabled={running || !tenantId} size="lg">
          {running ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("ag.liveRunning")}
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" /> {t("ag.liveRunAll")}
            </>
          )}
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">{t("ag.liveLoading")}</CardContent>
        </Card>
      ) : !tenantId ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("ag.liveNoTenantTitle")}</CardTitle>
            <CardDescription>{t("ag.liveNoTenantDesc")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <AcosAgentRuns tenantId={tenantId} />
      )}
    </div>
  );
}
