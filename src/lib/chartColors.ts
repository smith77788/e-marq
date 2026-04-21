/**
 * Палітра для діаграм recharts.
 *
 * ВАЖЛИВО: дизайн-токени проєкту визначені в `oklch(...)` у src/styles.css.
 * Тому НЕ можна обгортати їх у `hsl(var(--token))` — це не працює з oklch.
 * Використовуй ТІЛЬКИ `var(--token)` напряму.
 *
 * Використання:
 *   <Area stroke={CHART.primary} fill={CHART.primaryFill} />
 *   <Tooltip contentStyle={CHART.tooltipStyle} />
 */
export const CHART = {
  primary: "var(--primary)",
  primaryFill: "color-mix(in oklab, var(--primary) 22%, transparent)",
  primarySoft: "color-mix(in oklab, var(--primary) 12%, transparent)",
  secondary: "var(--secondary)",
  accent: "var(--accent)",
  success: "var(--success, var(--primary))",
  warning: "var(--warning, var(--primary))",
  destructive: "var(--destructive)",
  border: "var(--border)",
  muted: "var(--muted-foreground)",
  foreground: "var(--foreground)",
  popover: "var(--popover)",
  card: "var(--card)",

  tooltipStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    fontSize: 12,
    color: "var(--popover-foreground)",
    boxShadow: "0 8px 24px -12px rgba(0,0,0,0.25)",
  } as React.CSSProperties,

  tickStyle: {
    fill: "var(--muted-foreground)",
    fontSize: 11,
  } as const,

  gridStroke: "var(--border)",
  gridDash: "3 3",
  cursorFill: "color-mix(in oklab, var(--accent) 40%, transparent)",
} as const;

/**
 * Шкала кольорів для категоріальних даних (агенти, сегменти, канали).
 * 6 кроків — досить для більшості випадків.
 */
export const CHART_SCALE = [
  "var(--primary)",
  "color-mix(in oklab, var(--primary) 75%, var(--accent) 25%)",
  "color-mix(in oklab, var(--primary) 50%, var(--accent) 50%)",
  "color-mix(in oklab, var(--primary) 25%, var(--accent) 75%)",
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 60%, var(--foreground) 40%)",
] as const;

/**
 * 5-рівнева шкала для heatmap (від низького до високого).
 * Використовується в CohortRetention, AgentHealthHeatmap.
 */
export const HEATMAP_SCALE = [
  "color-mix(in oklab, var(--muted) 80%, transparent)",
  "color-mix(in oklab, var(--primary) 18%, transparent)",
  "color-mix(in oklab, var(--primary) 38%, transparent)",
  "color-mix(in oklab, var(--primary) 62%, transparent)",
  "color-mix(in oklab, var(--primary) 92%, transparent)",
] as const;

export function heatmapColor(value: number, max = 1): string {
  if (!isFinite(value) || max <= 0) return HEATMAP_SCALE[0];
  const ratio = Math.max(0, Math.min(1, value / max));
  const idx = Math.min(HEATMAP_SCALE.length - 1, Math.floor(ratio * HEATMAP_SCALE.length));
  return HEATMAP_SCALE[idx];
}
