import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageShell } from "@/components/marketing/LegalPageShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () =>
    buildSeo({
      title: tStatic("site.legal.privacy") + " — MARQ",
      description:
        "How MARQ collects, processes and protects your personal data and your customers' data. GDPR-aligned.",
      path: "/privacy",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { lang, t } = useT();
  const updated = lang === "ua" ? "26 квітня 2026" : "April 26, 2026";

  return (
    <LegalPageShell
      title={t("site.legal.privacy")}
      intro={
        lang === "ua"
          ? "Ми поважаємо ваше право на приватність. Цей документ описує, які дані ми збираємо, як використовуємо й захищаємо."
          : "We respect your privacy. This document explains what data we collect, how we use it and how we protect it."
      }
      updated={updated}
    >
      {lang === "ua" ? <PrivacyUA /> : <PrivacyEN />}
      <hr className="my-8 border-border" />
      <p className="text-xs text-muted-foreground">
        Запити щодо ваших даних:{" "}
        <Link to="/contact" className="text-primary hover:underline">
          /contact
        </Link>
      </p>
    </LegalPageShell>
  );
}

function PrivacyUA() {
  return (
    <>
      <h2>1. Які дані ми збираємо</h2>
      <ul>
        <li>
          <strong>Дані акаунту:</strong> email, імʼя, IP-адреса, мова інтерфейсу.
        </li>
        <li>
          <strong>Дані бренду:</strong> назва, slug, налаштування магазину, інтеграції.
        </li>
        <li>
          <strong>Бізнес-дані:</strong> товари, клієнти, замовлення, події, які ви завантажуєте
          або які надходять через інтеграції.
        </li>
        <li>
          <strong>Технічні логи:</strong> час доступу, тип браузера, помилки — для діагностики.
        </li>
      </ul>

      <h2>2. Навіщо ми це використовуємо</h2>
      <ul>
        <li>Надавати та підтримувати сервіс.</li>
        <li>Тренувати агентів виключно у межах вашого тенанта (без cross-tenant навчання).</li>
        <li>Виставляти рахунки.</li>
        <li>Захищати від зловживань (anti-fraud).</li>
        <li>Звʼязуватись з вами у важливих питаннях (білінг, безпека, зміни умов).</li>
      </ul>

      <h2>3. Хто має доступ</h2>
      <p>
        Доступ до ваших даних мають лише: ви та запрошені члени вашої команди; обмежене коло
        інженерів MARQ виключно для технічної підтримки за вашим явним запитом; підрядники
        обробки даних (хостинг, email-провайдер) — на умовах конфіденційності.
      </p>

      <h2>4. Передача третім сторонам</h2>
      <p>
        Ми не продаємо й не передаємо ваші дані для маркетингу. Ми використовуємо такі сервіси:
      </p>
      <ul>
        <li>Хостинг бази даних та edge-функцій (Supabase / Cloudflare).</li>
        <li>OAuth-провайдер Google для входу.</li>
        <li>Email-провайдер для транзакційних листів.</li>
        <li>LLM-провайдери для роботи ШІ-агентів — без передачі персональних даних клієнтів.</li>
      </ul>

      <h2>5. Зберігання та видалення</h2>
      <p>
        Дані зберігаються доки активний акаунт. Після закриття акаунту дані видаляються протягом
        30 днів, окрім того, що вимагає податкове законодавство (виставлені рахунки).
      </p>

      <h2>6. Ваші права (GDPR / UA)</h2>
      <ul>
        <li>Право на доступ — ви можете експортувати всі свої дані.</li>
        <li>Право на виправлення — редагуйте дані з панелі налаштувань.</li>
        <li>Право на видалення — закрийте акаунт або напишіть нам.</li>
        <li>Право на портативність — експорт у JSON/CSV.</li>
        <li>Право на скаргу — до Уповноваженого ВРУ з прав людини або відповідного DPA в ЄС.</li>
      </ul>

      <h2>7. Cookies</h2>
      <p>
        Ми використовуємо тільки технічно-необхідні cookies (сесія, мовні налаштування). Жодних
        рекламних або трекінгових cookies третіх сторін.
      </p>

      <h2>8. Безпека</h2>
      <ul>
        <li>Уся передача даних — через HTTPS.</li>
        <li>База даних з RLS (row-level security) — ваші дані ізольовано від інших брендів.</li>
        <li>Регулярні автоматичні бекапи.</li>
        <li>Двофакторна автентифікація на запит.</li>
      </ul>

      <h2>9. Зміни цієї політики</h2>
      <p>
        Про істотні зміни ми повідомимо на email за 14 днів. Поточна версія завжди доступна на
        цій сторінці.
      </p>
    </>
  );
}

function PrivacyEN() {
  return (
    <>
      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> email, name, IP address, UI language.
        </li>
        <li>
          <strong>Brand data:</strong> name, slug, store settings, integrations.
        </li>
        <li>
          <strong>Business data:</strong> products, customers, orders, events you upload or
          receive via integrations.
        </li>
        <li>
          <strong>Technical logs:</strong> access time, browser type, errors — for diagnostics.
        </li>
      </ul>

      <h2>2. Why we use it</h2>
      <ul>
        <li>To provide and maintain the service.</li>
        <li>To train agents within your tenant only (no cross-tenant training).</li>
        <li>To bill you.</li>
        <li>To protect against abuse (anti-fraud).</li>
        <li>To contact you about billing, security and material changes.</li>
      </ul>

      <h2>3. Who has access</h2>
      <p>
        Access is limited to: you and invited team members; a small group of MARQ engineers for
        technical support upon your explicit request; data processors (hosting, email) under
        confidentiality.
      </p>

      <h2>4. Third parties</h2>
      <p>We do not sell or share your data for marketing. We rely on:</p>
      <ul>
        <li>Database & edge functions hosting (Supabase / Cloudflare).</li>
        <li>Google OAuth for sign-in.</li>
        <li>Email provider for transactional emails.</li>
        <li>LLM providers for AI agents — without transmitting customer PII.</li>
      </ul>

      <h2>5. Retention and deletion</h2>
      <p>
        Data is retained while the account is active. After closure, data is deleted within 30
        days, except where tax law requires retention (issued invoices).
      </p>

      <h2>6. Your rights (GDPR)</h2>
      <ul>
        <li>Right to access — export all your data.</li>
        <li>Right to rectification — edit from settings.</li>
        <li>Right to erasure — close your account or email us.</li>
        <li>Right to portability — JSON/CSV export.</li>
        <li>Right to lodge a complaint with your local DPA.</li>
      </ul>

      <h2>7. Cookies</h2>
      <p>
        We use only strictly-necessary cookies (session, language preference). No third-party
        advertising or tracking cookies.
      </p>

      <h2>8. Security</h2>
      <ul>
        <li>All data in transit is encrypted via HTTPS.</li>
        <li>Database with row-level security — your data is isolated from other tenants.</li>
        <li>Regular automated backups.</li>
        <li>Two-factor authentication on request.</li>
      </ul>

      <h2>9. Changes to this policy</h2>
      <p>
        Material changes are communicated by email at least 14 days in advance. The current
        version is always available on this page.
      </p>
    </>
  );
}
