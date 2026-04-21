/**
 * Universal Detail System — shared types.
 *
 * Every "detailable" element on the site can declare its identity
 * (resourceType + elementId) and a `fetchDetail` function. The detail
 * payload is a normalised shape so the drawer can render any kind
 * of resource (product, customer, kpi, order, ...) without bespoke UI.
 */

export type ResourceType =
  | "kpi"
  | "product"
  | "customer"
  | "order"
  | "outbound"
  | "insight"
  | "agent"
  | "integration"
  | "row"
  | "metric"
  | "post"
  | "notification"
  | "generic";

export type DrawerSize = "sm" | "md" | "lg" | "fullscreen";

export type MetricBlock = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "primary";
};

export type TimeseriesPoint = {
  /** ISO date or any short label, e.g. "Mon", "12:00", "2024-01-12" */
  t: string;
  /** Primary numeric value */
  v: number;
};

export type EventLogItem = {
  id: string;
  at: string; // ISO
  title: string;
  description?: string;
  icon?: "info" | "success" | "warning" | "destructive";
};

export type DetailAction = {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  /**
   * If `href` is set, the action is a link. Otherwise `onRun` is invoked.
   */
  href?: string;
  onRun?: () => Promise<void> | void;
  disabled?: boolean;
  description?: string;
};

export type RelatedItem = {
  id: string;
  resourceType: ResourceType;
  title: string;
  subtitle?: string;
  badge?: string;
};

export type MediaItem = {
  url: string;
  alt?: string;
  kind?: "image" | "video";
};

export type AiInsightBlock = {
  id: string;
  title: string;
  body: string;
  confidence?: number;
  tone?: "info" | "success" | "warning" | "destructive";
};

export type DetailPayload = {
  title: string;
  subtitle?: string;
  status?: { label: string; tone?: "default" | "success" | "warning" | "destructive" | "primary" };
  metrics?: MetricBlock[];
  timeseries?: TimeseriesPoint[];
  /** Long-form description / markdown-friendly text. We render as plain paragraphs. */
  description?: string;
  events_log?: EventLogItem[];
  actions?: DetailAction[];
  related_items?: RelatedItem[];
  media?: MediaItem[];
  metadata?: Record<string, string | number | boolean | null>;
  ai_insights?: AiInsightBlock[];
};

export type DetailHandle = {
  resourceType: ResourceType;
  elementId: string;
  drawerTitle?: string;
  drawerSize?: DrawerSize;
  /**
   * Async loader for the full detail payload. Caller may also provide
   * `payload` directly (eager) and skip the loader.
   */
  fetchDetail?: () => Promise<DetailPayload>;
  /** Eager payload (skips fetch). */
  payload?: DetailPayload;
};
