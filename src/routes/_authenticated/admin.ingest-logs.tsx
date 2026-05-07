import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { IngestLogsView } from "@/components/admin/IngestLogsView";

export const Route = createFileRoute("/_authenticated/admin/ingest-logs")({
  head: () => ({
    meta: [
      { title: "Ingest logs · Admin" },
      { name: "description", content: "Усі POST на /hooks/ingest з усіх tenant-ів" },
    ],
  }),
  component: AdminIngestLogsRoute,
});

function AdminIngestLogsRoute() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/brand" />;
  return <IngestLogsView title="Ingest logs (всі tenant-и)" />;
}
