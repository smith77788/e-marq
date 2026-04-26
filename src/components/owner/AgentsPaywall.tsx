/**
 * Paywall для розділу агентів. Показуємо коли в tenant немає активної підписки.
 * Веде на /brand/billing — там можна обрати Free або платний тариф.
 */
import { Link } from "@tanstack/react-router";
import { Bot, Crown, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AgentsPaywall({ tenantId, status }: { tenantId: string; status: string | null }) {
  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">Оберіть тариф, щоб увімкнути ШІ-агентів</CardTitle>
          <CardDescription className="text-base">
            {status === "past_due"
              ? "Оплата по тарифу прострочена — поновіть, щоб агенти знову працювали."
              : status === "cancelled" || status === "suspended"
                ? "Підписку зупинено. Поновіть тариф, щоб повернути доступ."
                : "Доступ до бібліотеки агентів і live-запусків відкривається після обрання тарифу. Є безкоштовний план із базовими агентами."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>70+ агентів: продажі, утримання, контент, операційка, аналітика</span>
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>Інсайти автоматично — щодня, щотижня, або в реальному часі</span>
            </li>
            <li className="flex items-start gap-2">
              <Crown className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>Без обмеження по хвилинах чи кредитах у межах тарифу</span>
            </li>
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1" size="lg">
              <Link to="/brand/billing" search={{ tenant: tenantId }}>
                Обрати тариф
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/pricing">Порівняти тарифи</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
