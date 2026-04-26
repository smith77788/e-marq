import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageShell } from "@/components/marketing/LegalPageShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/refund")({
  head: () =>
    buildSeo({
      title: tStatic("site.legal.refund") + " — MARQ",
      description:
        "MARQ refund policy: when refunds apply, how to request one, and how cancellations work.",
      path: "/refund",
    }),
  component: RefundPage,
});

function RefundPage() {
  const { lang, t } = useT();
  const updated = lang === "ua" ? "26 квітня 2026" : "April 26, 2026";

  return (
    <LegalPageShell
      title={t("site.legal.refund")}
      intro={
        lang === "ua"
          ? "Прозоро про те, коли ми повертаємо кошти, а коли — ні."
          : "Clear rules on when we refund and when we don't."
      }
      updated={updated}
    >
      {lang === "ua" ? <RefundUA /> : <RefundEN />}
      <hr className="my-8 border-border" />
      <p className="text-xs text-muted-foreground">
        Запит на повернення коштів:{" "}
        <Link to="/contact" className="text-primary hover:underline">
          /contact
        </Link>
      </p>
    </LegalPageShell>
  );
}

function RefundUA() {
  return (
    <>
      <h2>1. 14 днів на тестування</h2>
      <p>
        Якщо ви оплатили платний тариф уперше і вирішили відмовитись протягом{" "}
        <strong>14 днів</strong>, ми повертаємо 100% коштів без зайвих питань — за умови, що ви не
        використали MARQ для надсилання комерційних повідомлень понад 100 одержувачам.
      </p>

      <h2>2. Скасування підписки</h2>
      <p>
        Скасуйте підписку у будь-який час у панелі білінгу. Ви матимете доступ до сервісу до кінця
        оплаченого періоду. Часткові повернення за невикористані дні в межах місяця за замовчуванням
        не виплачуються.
      </p>

      <h2>3. Коли ми не повертаємо</h2>
      <ul>
        <li>Якщо акаунт призупинено через порушення Умов використання.</li>
        <li>Якщо ви активно використовували сервіс понад 14 днів.</li>
        <li>Якщо повернення стосується послуги, наданої на ваш індивідуальний запит.</li>
      </ul>

      <h2>4. Як повернути кошти</h2>
      <p>Напишіть на email підтримки або через форму /contact. Вкажіть:</p>
      <ul>
        <li>Email акаунту.</li>
        <li>Назву бренду (тенанта).</li>
        <li>Дату оплати та суму.</li>
        <li>Коротко — причину (необовʼязково, але допомагає нам ставати кращими).</li>
      </ul>
      <p>Розгляд — до 5 робочих днів. Кошти повертаються тим самим способом, що й оплата.</p>

      <h2>5. Технічні збої з нашого боку</h2>
      <p>
        Якщо MARQ був недоступний понад 24 години поспіль через нашу провину, ми надамо компенсацію
        — кредит на наступний місяць пропорційно тривалості простою.
      </p>
    </>
  );
}

function RefundEN() {
  return (
    <>
      <h2>1. 14-day refund window</h2>
      <p>
        If you paid for a plan for the first time and want out within <strong>14 days</strong>,
        we'll refund 100% — provided you haven't used MARQ to send commercial messages to more than
        100 recipients.
      </p>

      <h2>2. Subscription cancellation</h2>
      <p>
        Cancel any time from the billing panel. You retain access until the end of the paid period.
        We don't pro-rate refunds for unused days in the current month by default.
      </p>

      <h2>3. When we don't refund</h2>
      <ul>
        <li>The account was suspended for violating the Terms of Service.</li>
        <li>You actively used the service beyond 14 days.</li>
        <li>The charge was for a service rendered on your individual request.</li>
      </ul>

      <h2>4. How to request a refund</h2>
      <p>Email support or use /contact. Include:</p>
      <ul>
        <li>Account email.</li>
        <li>Brand (tenant) name.</li>
        <li>Payment date and amount.</li>
        <li>Brief reason (optional but helpful).</li>
      </ul>
      <p>
        We respond within 5 business days. Refunds are issued through the original payment method.
      </p>

      <h2>5. Outages on our side</h2>
      <p>
        If MARQ is unavailable for more than 24 consecutive hours due to our fault, we provide
        next-month service credit proportional to the downtime.
      </p>
    </>
  );
}
