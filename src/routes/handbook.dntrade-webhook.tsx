/**
 * /handbook/dntrade-webhook — інтеграторська документація для DN Trade webhook та health-ендпоінта.
 * Українською. Доступна без авторизації.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowLeft, CheckCircle2, KeyRound, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/handbook/dntrade-webhook")({
  head: () => ({
    meta: [
      { title: "DN Trade webhook та health — документація для інтеграторів" },
      {
        name: "description",
        content:
          "Як підключити push-події з DN Trade, перевіряти стан інтеграції через /dntrade-webhook-health, що означають коди 200/404/503 та поля blockers і warnings.",
      },
    ],
  }),
  component: DnTradeDocsPage,
});

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function StatusRow({
  code,
  variant,
  title,
  desc,
}: {
  code: string;
  variant: "ok" | "warn" | "err" | "info";
  title: string;
  desc: string;
}) {
  const cls =
    variant === "ok"
      ? "border-success/40 text-success"
      : variant === "warn"
        ? "border-warning/40 text-warning"
        : variant === "err"
          ? "border-destructive/40 text-destructive"
          : "border-primary/40 text-primary";
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card/40 p-3 sm:flex-row sm:items-center sm:gap-4">
      <Badge variant="outline" className={`shrink-0 font-mono ${cls}`}>
        {code}
      </Badge>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

function DnTradeDocsPage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link
            to="/handbook"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            До посібника
          </Link>
          <Badge variant="outline" className="border-primary/30 text-primary">
            Інтеграторам
          </Badge>
        </div>
      </header>

      <article className="mx-auto max-w-4xl space-y-10 px-4 py-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            DN Trade · Webhook та health
          </h1>
          <p className="text-base text-muted-foreground">
            Цей документ — для тих, хто інтегрує магазин MARQ із DN Trade (dntrade.com.ua) і хоче
            приймати push-події про зміни, а також автоматично перевіряти стан інтеграції з
            зовнішніх систем моніторингу.
          </p>
        </div>

        {/* Quick start */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-4 w-4 text-primary" />
              Швидкий старт
            </CardTitle>
            <CardDescription>3 кроки, щоб увімкнути push-синхронізацію.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
              <li>
                У адмінці магазину MARQ відкрийте{" "}
                <Link to="/brand" className="text-foreground underline-offset-2 hover:underline">
                  /brand
                </Link>{" "}
                → картка <span className="font-semibold text-foreground">DN Trade інтеграція</span>.
              </li>
              <li>
                Згенеруйте <span className="font-mono">webhook_secret</span> кнопкою{" "}
                <span className="font-semibold">«Створити webhook URL»</span> і скопіюйте URL.
              </li>
              <li>
                У DN Trade (<span className="font-mono">Опції → Інтеграції</span>) додайте цей URL
                як endpoint для подій. Усе — далі ми самі підтягуємо зміни.
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* Webhook */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Webhook-приймач</h2>
          <p className="text-sm text-muted-foreground">URL формату:</p>
          <CodeBlock>
            POST
            https://e-marq.lovable.app/hooks/integrations/dntrade-webhook?tenant=&lt;tenant_id&gt;
          </CodeBlock>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Аутентифікація</strong> — один з двох варіантів
            (HMAC має пріоритет):
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Заголовок <span className="font-mono">X-DnTrade-Signature</span> з HMAC-SHA256 тіла
              запиту, ключ — <span className="font-mono">webhook_secret</span>. Підтримуються
              формати <span className="font-mono">sha256=&lt;hex&gt;</span> або просто{" "}
              <span className="font-mono">&lt;hex&gt;</span>.
            </li>
            <li>
              Query-параметр <span className="font-mono">?secret=&lt;webhook_secret&gt;</span> — для
              систем, що не підписують тіло.
            </li>
          </ul>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Коди відповіді</h3>
            <div className="grid gap-2">
              <StatusRow
                code="200"
                variant="ok"
                title="Прийнято"
                desc="Подія прийнята, інкрементальний синк запущено. Тіло JSON містить summary."
              />
              <StatusRow
                code="400"
                variant="err"
                title="Bad request"
                desc="Немає обов'язкового параметра tenant у URL."
              />
              <StatusRow
                code="401"
                variant="err"
                title="Unauthorized"
                desc="Немає підпису/секрету або вони невалідні."
              />
              <StatusRow
                code="404"
                variant="err"
                title="Integration not found"
                desc="Для вказаного tenant немає налаштованої DN Trade інтеграції."
              />
              <StatusRow
                code="409"
                variant="warn"
                title="Disabled / no API key"
                desc="Інтеграція вимкнена або не введено DN Trade ApiKey — повторний виклик не допоможе, поки не виправлено в адмінці."
              />
              <StatusRow code="500" variant="err" title="DB error" desc="Внутрішня помилка БД." />
              <StatusRow
                code="502"
                variant="err"
                title="Upstream sync failed"
                desc="DN Trade API повернув помилку або синк впав. Деталі — в dntrade_sync_errors."
              />
            </div>
          </div>
        </section>

        {/* Health */}
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Activity className="h-5 w-5 text-primary" />
            Health-чек
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only ендпоінт, що повідомляє, чи готова інтеграція приймати вебхуки. Підходить для
            зовнішніх uptime-моніторів (UptimeRobot, Better Uptime тощо).
          </p>
          <CodeBlock>
            GET
            https://e-marq.lovable.app/hooks/integrations/dntrade-webhook-health?tenant=&lt;tenant_id&gt;
          </CodeBlock>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Параметри</h3>
            <div className="rounded-md border border-border bg-card/40 p-3 text-sm">
              <span className="font-mono text-foreground">tenant</span>{" "}
              <span className="text-muted-foreground">
                — UUID тенанта (магазину). Знайти можна в адмінці на сторінці{" "}
                <Link to="/admin/tenants" className="underline-offset-2 hover:underline">
                  /admin/tenants
                </Link>
                .
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Коди відповіді</h3>
            <div className="grid gap-2">
              <StatusRow
                code="200"
                variant="ok"
                title="healthy / degraded"
                desc="Інтеграція готова приймати вебхуки. degraded означає, що є попередження (warnings), але блокерів немає."
              />
              <StatusRow
                code="400"
                variant="err"
                title="Bad request"
                desc="Не передано tenant у query."
              />
              <StatusRow
                code="404"
                variant="info"
                title="missing"
                desc="Інтеграцію DN Trade не налаштовано для цього тенанта."
              />
              <StatusRow
                code="500"
                variant="err"
                title="DB error"
                desc="Внутрішня помилка читання БД."
              />
              <StatusRow
                code="503"
                variant="err"
                title="unhealthy"
                desc="Інтеграція не готова: є blockers (вимкнена, немає API key чи webhook_secret)."
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <ShieldAlert className="h-4 w-4" />
                  blockers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <p>Критичні проблеми, через які інтеграція НЕ працюватиме:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>«Інтеграція вимкнена.»</li>
                  <li>«Не задано API key.»</li>
                  <li>«Не згенеровано webhook_secret.»</li>
                </ul>
                <p className="mt-2">
                  За наявності хоча б одного blockers — статус{" "}
                  <span className="font-mono">503</span>.
                </p>
              </CardContent>
            </Card>

            <Card className="border-warning/30 bg-warning/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-warning">
                  <CheckCircle2 className="h-4 w-4" />
                  warnings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <p>Не блокують роботу, але варті уваги:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>«Остання синхронізація &gt; N год тому.»</li>
                  <li>«Жодної синхронізації ще не було.»</li>
                  <li>«Остання синхронізація завершилась з помилками.»</li>
                </ul>
                <p className="mt-2">
                  Лише warnings → статус <span className="font-mono">200</span>, але{" "}
                  <span className="font-mono">status: "degraded"</span>.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Приклад відповіді</h3>
            <CodeBlock>{`{
  "status": "degraded",
  "ready": true,
  "checks": {
    "integration_exists": true,
    "is_active": true,
    "api_key_configured": true,
    "webhook_secret_configured": true
  },
  "blockers": [],
  "warnings": ["Остання синхронізація > 25 год тому."],
  "last_sync_at": "2026-04-20T08:14:22.000Z",
  "last_sync_status": "success",
  "last_sync_error": null,
  "last_sync_age_seconds": 91234
}`}</CodeBlock>
          </div>
        </section>

        {/* Internal monitoring */}
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Внутрішній моніторинг
          </h2>
          <p className="text-sm text-muted-foreground">
            Окрім зовнішніх моніторів, MARQ запускає свій cron щогодини:
            <span className="font-mono"> /hooks/integrations/dntrade-health-cron</span>. Він пише
            snapshot у таблицю <span className="font-mono">dntrade_health_log</span>, дублює
            degraded/unhealthy у <span className="font-mono">dntrade_sync_errors</span> і створює
            алерт у <span className="font-mono">owner_notifications</span>, якщо:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>тенант unhealthy безперервно ≥ 30 хвилин;</li>
            <li>≥ 3 partial-синків за останні 6 годин.</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Дедуп алертів: один на тип на 24 години, щоб не спамити.
          </p>
        </section>

        <div className="flex justify-center pt-4">
          <Button asChild variant="outline">
            <Link to="/handbook">← Повернутися до посібника</Link>
          </Button>
        </div>
      </article>
    </main>
  );
}
