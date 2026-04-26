import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageShell } from "@/components/marketing/LegalPageShell";
import { useT, tStatic } from "@/lib/i18n";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () =>
    buildSeo({
      title: tStatic("site.legal.terms") + " — MARQ",
      description:
        "MARQ Terms of Service: who can use MARQ, how billing works, intellectual property, data ownership, liability and dispute resolution.",
      path: "/terms",
    }),
  component: TermsPage,
});

function TermsPage() {
  const { lang, t } = useT();
  const updated = lang === "ua" ? "26 квітня 2026" : "April 26, 2026";

  return (
    <LegalPageShell
      title={t("site.legal.terms")}
      intro={
        lang === "ua"
          ? "Ці умови регулюють використання сервісу MARQ — платформи з ШІ-агентами для D2C-брендів."
          : "These terms govern your use of MARQ — an AI-agent platform for D2C brands."
      }
      updated={updated}
    >
      {lang === "ua" ? <TermsUA /> : <TermsEN />}
      <hr className="my-8 border-border" />
      <p className="text-xs text-muted-foreground">
        Контакт:{" "}
        <Link to="/contact" className="text-primary hover:underline">
          /contact
        </Link>
      </p>
    </LegalPageShell>
  );
}

function TermsUA() {
  return (
    <>
      <h2>1. Хто може користуватись MARQ</h2>
      <p>
        MARQ — це SaaS-платформа для власників бізнесу та їхніх команд. Ви маєте бути дієздатною
        особою або юридичною особою. Створюючи акаунт, ви підтверджуєте, що дані, які надаєте, є
        точними, і що у вас є право представляти бренд, який ви додаєте.
      </p>

      <h2>2. Тарифи та оплата</h2>
      <p>
        MARQ працює за моделлю підписки. Безкоштовний тариф (Free) діє безстроково, у межах квот.
        Платні тарифи (Starter, Growth, Scale) виставляються щомісячно за бренд.
      </p>
      <ul>
        <li>Оплата стягується наперед за наступний місяць.</li>
        <li>Зміна тарифу набирає чинності з наступного циклу білінгу.</li>
        <li>Несплата протягом 7 днів призводить до призупинення тенанта.</li>
        <li>Усі ціни вказані в гривнях; ПДВ (якщо застосовно) додається додатково.</li>
      </ul>

      <h2>3. Власні дані та контент</h2>
      <p>
        Усі дані, які ви завантажуєте до MARQ (товари, клієнти, замовлення, медіа), залишаються
        вашою власністю. Ми обробляємо їх виключно для надання сервісу. Ви можете експортувати свої
        дані будь-коли.
      </p>

      <h2>4. ШІ-агенти та автоматизація</h2>
      <p>
        MARQ використовує великі мовні моделі для автоматизації маркетингових і операційних задач.
        Ми не гарантуємо безпомилкову роботу ШІ. Усі автоматизації, що генерують фінансові операції
        (оплати, рекламні бюджети), вимагають вашого явного підтвердження.
      </p>

      <h2>5. Заборонене використання</h2>
      <ul>
        <li>Розсилати спам або нелегальний контент клієнтам.</li>
        <li>Продавати товари, заборонені законодавством України або країни клієнта.</li>
        <li>Використовувати MARQ для атак, обходу безпеки або реверс-інжинірингу платформи.</li>
        <li>Передавати облікові дані третім особам без письмової згоди.</li>
      </ul>

      <h2>6. Призупинення та припинення</h2>
      <p>
        Ми можемо призупинити або закрити акаунт у разі порушення цих умов. Ви можете закрити акаунт
        у будь-який час із панелі налаштувань — дані видаляються протягом 30 днів.
      </p>

      <h2>7. Обмеження відповідальності</h2>
      <p>
        Сервіс надається «як є». MARQ не несе відповідальності за непрямі або похідні збитки.
        Загальна відповідальність MARQ обмежена сумою, сплаченою вами за останні 3 місяці.
      </p>

      <h2>8. Зміни умов</h2>
      <p>
        Ми можемо оновлювати ці умови. Про істотні зміни ми повідомимо за 14 днів на email. Подальше
        використання сервісу означає згоду з оновленими умовами.
      </p>

      <h2>9. Право та юрисдикція</h2>
      <p>
        Ці умови регулюються правом України. Спори вирішуються переговорами; за відсутності згоди —
        у судах за місцем реєстрації MARQ.
      </p>
    </>
  );
}

function TermsEN() {
  return (
    <>
      <h2>1. Who can use MARQ</h2>
      <p>
        MARQ is a SaaS platform for business owners and their teams. You must be of legal age or a
        registered legal entity. By creating an account, you confirm that the data you provide is
        accurate and that you have the authority to represent the brand you add.
      </p>

      <h2>2. Plans and billing</h2>
      <p>
        MARQ runs on a subscription model. The Free tier is permanent within its quotas. Paid tiers
        (Starter, Growth, Scale) are billed monthly per brand.
      </p>
      <ul>
        <li>Payment is charged upfront for the next month.</li>
        <li>Plan changes take effect from the next billing cycle.</li>
        <li>Non-payment for more than 7 days leads to tenant suspension.</li>
        <li>All prices are in UAH; VAT (where applicable) is added on top.</li>
      </ul>

      <h2>3. Your data and content</h2>
      <p>
        All data you upload to MARQ (products, customers, orders, media) remains your property. We
        process it solely to provide the service. You can export your data at any time.
      </p>

      <h2>4. AI agents and automation</h2>
      <p>
        MARQ uses large language models to automate marketing and operations. We don't guarantee
        flawless AI behavior. Any automation that triggers financial actions (payments, ad spend)
        requires your explicit confirmation.
      </p>

      <h2>5. Prohibited use</h2>
      <ul>
        <li>Sending spam or illegal content to your customers.</li>
        <li>Selling goods prohibited by your jurisdiction.</li>
        <li>Using MARQ to attack, circumvent security, or reverse-engineer the platform.</li>
        <li>Sharing credentials with third parties without written consent.</li>
      </ul>

      <h2>6. Suspension and termination</h2>
      <p>
        We may suspend or close an account that violates these terms. You may close your account at
        any time from settings — data is deleted within 30 days.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        The service is provided "as is". MARQ is not liable for indirect or consequential damages.
        MARQ's total liability is limited to fees paid in the last 3 months.
      </p>

      <h2>8. Changes to these terms</h2>
      <p>
        We may update these terms. Material changes will be communicated by email at least 14 days
        in advance. Continued use of the service constitutes acceptance.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These terms are governed by the laws of Ukraine. Disputes are resolved through negotiation
        first; failing that, by courts at MARQ's place of registration.
      </p>
    </>
  );
}
