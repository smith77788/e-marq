---
name: no-lovable-ai-credits
description: AI completions через ai.gateway.lovable.dev/v1/chat/completions ВИМКНЕНО за замовчуванням
type: constraint
---

# AI killswitch — НЕ витрачати Lovable AI credits

Користувач явно попросив уникати всіх платних функцій що витрачають кредити Lovable AI.

## Як реалізовано

Централізований модуль `src/lib/acos/aiKillswitch.ts` експортує `isLovableAiEnabled()`.
**За замовчуванням повертає `false`** — навіть якщо `LOVABLE_API_KEY` встановлений, AI-виклики не робляться.

Увімкнути можна лише явно через env:

- `ACOS_AI_ENABLED=1` (opt-in)
- `ACOS_AI_DISABLED=1` (примусове вимкнення поверх opt-in)

## Точки застосування (4 файли)

1. `src/routes/api/ai.ask.ts` — Command Palette AI Ask → fallback з реальних метрик
2. `src/lib/acos/salesBot.ts` — Sales bot reply → повертає null
3. `src/routes/hooks/engines.winback-one.ts` — Winback single → детермінований шаблон
4. `src/routes/hooks/engines.winback.ts` — Winback cron → null (caller fallback)

## ВАЖЛИВО — що НЕ є AI-витратами

`LOVABLE_API_KEY` також використовується як проксі для:

- Resend (email): `src/lib/email/resendGateway.ts`, `src/routes/api/email.*`
- Telegram bot: `src/routes/hooks/telegram.*`

Це **не** AI-витрати — це проксі через Lovable Gateway. НЕ застосовуй killswitch там.

## При додаванні нових AI-фіч

ОБОВ'ЯЗКОВО:

1. Імпортуй `isLovableAiEnabled` з `@/lib/acos/aiKillswitch`
2. Перевіряй на самому початку функції
3. Завжди май детермінований fallback (template/heuristic)

Не використовуй raw `process.env.LOVABLE_API_KEY` як єдиний guard для AI-completions.
