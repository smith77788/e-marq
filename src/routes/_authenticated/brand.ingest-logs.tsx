import { createFileRoute } from "@tanstack/react-router";
import { useTenantContext } from "@/hooks/useTenantContext";
import { IngestLogsView } from "@/components/admin/IngestLogsView";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/brand/ingest-logs")({
  head: () => ({
    meta: [
      { title: "Ingest logs · Brand" },
      { name: "description", content: "POST на /hooks/ingest для вашого бренду" },
    ],
  }),
  component: BrandIngestLogsRoute,
});

function BrandIngestLogsRoute() {
  const { currentTenantId, loading } = useTenantContext();
  if (loading) return null;
  if (!currentTenantId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Оберіть бренд у сайдбарі, щоб переглянути логи ingest.
          </CardContent>
        </Card>
      </div>
    );
  }
  return <IngestLogsView tenantId={currentTenantId} title="Ingest logs (мій бренд)" />;
}
