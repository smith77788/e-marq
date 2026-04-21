import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "@/lib/chartColors";

type Point = { day: string; revenue: number; orders: number };

type Props = {
  points: Point[];
};

export function CrossTenantPulse({ points }: Props) {
  const data = useMemo(
    () =>
      points.map((p) => ({
        day: new Date(p.day).toLocaleDateString("uk-UA", {
          month: "short",
          day: "numeric",
        }),
        revenue: Math.round(p.revenue / 100),
        orders: p.orders,
      })),
    [points],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Поки що даних замало — згенеруйте демо-набір для будь-якого бренду.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cross-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.primary} stopOpacity={0.55} />
              <stop offset="100%" stopColor={CHART.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.gridStroke} strokeDasharray={CHART.gridDash} opacity={0.4} />
          <XAxis
            dataKey="day"
            stroke={CHART.muted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={CHART.muted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={CHART.tooltipStyle}
            cursor={{ fill: CHART.cursorFill }}
            formatter={(v: number, name) =>
              name === "revenue"
                ? [`${v.toLocaleString("uk-UA")} ₴`, "Виторг"]
                : [v, "Замовлення"]
            }
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={CHART.primary}
            strokeWidth={2}
            fill="url(#cross-rev)"
            animationDuration={500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
