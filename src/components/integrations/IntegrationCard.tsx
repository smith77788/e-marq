/**
 * Картка одного джерела даних.
 * Показує: іконку, назву, опис, чесний статус, методи, що імпортує.
 * При кліку — відкриває wizard підключення.
 */
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  METHOD_LABELS,
  STATUS_LABELS,
  type IntegrationDef,
} from "@/lib/integrations/catalog";

type Props = {
  integration: IntegrationDef;
  isConnected?: boolean;
  onSelect: (integration: IntegrationDef) => void;
};

const IMPORT_LABELS: Record<string, string> = {
  products: "товари",
  customers: "клієнти",
  orders: "замовлення",
  transactions: "транзакції",
  events: "події",
};

export function IntegrationCard({ integration, isConnected, onSelect }: Props) {
  const Icon = integration.icon;
  const status = STATUS_LABELS[integration.status];
  const isComingSoon = integration.status === "comingSoon";

  return (
    <Card
      className={cn(
        "group flex h-full flex-col transition-all hover:shadow-elegant",
        isConnected && "border-success/40 bg-success/5",
        isComingSoon && "opacity-80",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold leading-tight">{integration.name}</h3>
            <p className="text-xs text-muted-foreground">{METHOD_LABELS[integration.method]}</p>
          </div>
        </div>
        {isConnected && (
          <Badge className="border-success/40 bg-success/15 text-success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            підключено
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-3 text-sm text-muted-foreground">{integration.description}</p>

        <div className="flex flex-wrap gap-1">
          {integration.imports.map((imp) => (
            <span
              key={imp}
              className="rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {IMPORT_LABELS[imp] ?? imp}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Badge variant="outline" className={cn("text-[10px]", status.tone)}>
            {status.label}
          </Badge>
          <Button
            size="sm"
            variant={isComingSoon ? "outline" : "default"}
            onClick={() => onSelect(integration)}
            className="gap-1"
          >
            {isComingSoon ? "Інструкція" : isConnected ? "Налаштувати" : "Підключити"}
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
