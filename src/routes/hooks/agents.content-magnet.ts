/**
 * Lead Agent: Content Magnet
 *
 * Безкоштовний канал залучення: автоматично генерує SEO-сторінки-гайди
 * (`/m/<slug>`) для популярних запитів українських магазинів. Кожна
 * сторінка містить корисний контент + CTA на /signup. Це створює
 * безкоштовний органічний трафік без реклами.
 *
 * Працює як seed: створює 6 базових магнітів, якщо їх ще немає.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { authorizeLeadAgent } from "@/lib/lead/auth";

const SEED: Array<{
  slug: string;
  title: string;
  meta_description: string;
  topic: string;
  keywords: string[];
  body_md: string;
}> = [
  {
    slug: "ai-bot-for-shopify-ukraine",
    title: "AI-бот для магазину в Україні: як налаштувати за 1 день",
    meta_description:
      "Покрокова інструкція як підключити AI-консультанта в Telegram до інтернет-магазину в Україні без розробників.",
    topic: "ai_bot",
    keywords: ["ai бот", "telegram бот", "магазин україна", "shopify бот"],
    body_md: `# AI-бот для українського магазину\n\nКонсультант, який відповідає 24/7, продає, повертає клієнтів і не вимагає зарплати.\n\n## Що вміє правильний AI-бот\n- Відповідає на запитання про товар, доставку, оплату\n- Закриває заперечення українською мовою\n- Робить апсейл («до цього часто беруть…»)\n- Сповіщає власника про дорогі замовлення\n\n## Як підключити за 1 день\n- Зареєструйтесь у MARQ (60 сек.)\n- Підключіть товари з CSV або Shopify\n- Відкрийте Telegram-бот і додайте у канал\n\n## Скільки коштує\nПерші 14 днів — безкоштовно. Далі від 290₴/міс.`,
  },
  {
    slug: "winback-email-template-ua",
    title: "Шаблон листа win-back для українського магазину (з прикладами)",
    meta_description:
      "Готові тексти win-back розсилки, яка повертає 12-18% клієнтів, що перестали купувати.",
    topic: "winback",
    keywords: ["win-back", "email маркетинг", "повернення клієнтів"],
    body_md: `# Win-back шаблон\n\nТемна сторона e-commerce: 70% клієнтів роблять одне замовлення і зникають.\n\n## Шаблон №1 — «Ми скучили»\n*Тема:* «Сумуємо за вами 💛»\n\nПривіт, {{name}}! Минуло {{days}} днів — повертайтесь зі знижкою 10% на улюблене.\n\n## Шаблон №2 — «Що нового»\nПогляньте, що зʼявилось у нас з часу вашого останнього замовлення.\n\n## Як автоматизувати\nMARQ робить це сам — підбирає клієнтів і час, генерує текст під ваш бренд.`,
  },
  {
    slug: "abandoned-cart-recovery-ukraine",
    title: "Як відновити покинутий кошик: 3 канали, які працюють в Україні",
    meta_description:
      "Покинутий кошик — це 60-70% потенційного виторгу. Як повернути ці гроші через Telegram, e-mail і ретаргет.",
    topic: "abandoned_cart",
    keywords: ["покинутий кошик", "abandoned cart", "telegram"],
    body_md: `# Покинутий кошик: як повернути 30% виторгу\n\n## Чому йдуть\n- Доставка дорожча за очікувану\n- Не хочуть реєструватись\n- Немає Apple Pay / Google Pay\n\n## 3 канали повернення\n1. **Telegram** — миттєвий, OPEN-rate 80%\n2. **Email** — найдешевший, 12-15% повернення\n3. **Ретаргет в Instagram** — для холодніших клієнтів\n\n## Готова автоматизація\nВ MARQ ці три канали працюють «з коробки» — залишилось підключити магазин.`,
  },
  {
    slug: "telegram-shop-bot-ukraine",
    title: "Як зробити магазин в Telegram-боті безкоштовно (Україна, 2026)",
    meta_description:
      "Telegram-магазин для бренду — швидко, без сайту і програмістів. Інструкція з прикладами.",
    topic: "telegram",
    keywords: ["telegram магазин", "telegram bot", "магазин без сайту"],
    body_md: `# Магазин у Telegram\n\n## Кому підходить\n- Локальні бренди без бюджету на сайт\n- Hand-made, food, цифрові товари\n\n## 4 кроки\n1. Створіть бота через @BotFather\n2. Підключіть до MARQ — він додасть каталог\n3. Налаштуйте оплату (Monobank/LiqPay)\n4. Запросіть покупців з Instagram\n\n## Бонус: автопости в Instagram\nMARQ генерує сторіс-нагадування, коли товар повертається в наявність.`,
  },
  {
    slug: "ai-pricing-for-online-store",
    title: "Динамічне ціноутворення з AI: кейси українських магазинів",
    meta_description:
      "Як AI підказує оптимальну ціну для кожного товару й піднімає маржу на 5-12%.",
    topic: "pricing",
    keywords: ["dynamic pricing", "ai ціни", "ecommerce україна"],
    body_md: `# Динамічне ціноутворення з AI\n\n## Що це\nАлгоритм аналізує попит, конкурентів, час доби і пропонує точкові зміни цін.\n\n## Приклади\n- Косметика: +6% маржі без падіння продажів\n- Каса: автоматичні sale-вікна на «гойдалці»\n- Дитячий одяг: знижки на низькоходові SKU\n\n## Як спробувати\nMARQ Price Optimizer вмикається в один клік і працює навіть на безкоштовному тарифі.`,
  },
  {
    slug: "marq-vs-mailchimp-shopify",
    title: "MARQ vs Mailchimp + Shopify: що дешевше і краще для бренду в Україні",
    meta_description:
      "Чесне порівняння AI-помічника MARQ і класичного стеку Mailchimp + Shopify для українських брендів.",
    topic: "comparison",
    keywords: ["marq", "mailchimp", "shopify", "україна"],
    body_md: `# MARQ vs Mailchimp + Shopify\n\n## Ціна\n- Shopify: $29/міс\n- Mailchimp: від $13/міс\n- MARQ: від 290₴/міс із усім стеком\n\n## Локалізація\n- MARQ: UAH, NovaPoshta, LiqPay/Monobank\n- Shopify: тільки міжнародний\n\n## AI «з коробки»\n- MARQ: 90+ агентів, які приймають рішення\n- Shopify+Mailchimp: вручну\n\n## Висновок\nДля українського бренду MARQ — це готове рішення без зайвих підписок.`,
  },
];

export const Route = createFileRoute("/hooks/agents/content-magnet")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeLeadAgent(request);
        if ("error" in auth) return jsonError(auth.error, auth.status);

        let created = 0;
        for (const m of SEED) {
          const { error } = await supabaseAdmin
            .from("lead_magnets")
            .upsert(
              {
                slug: m.slug,
                title: m.title,
                meta_description: m.meta_description,
                topic: m.topic,
                keywords: m.keywords,
                body_md: m.body_md,
                cta_url: "/signup",
                is_published: true,
              },
              { onConflict: "slug", ignoreDuplicates: true } as never,
            );
          if (!error) created += 1;
        }
        return jsonOk({ ok: true, seeded: SEED.length, created });
      },
    },
  },
});
