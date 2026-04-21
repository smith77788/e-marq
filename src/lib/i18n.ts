/**
 * Тонкий bilingual layer: UA (за замовчуванням) + EN.
 * Зберігаємо вибір у localStorage, без зовнішніх залежностей.
 */
import { useSyncExternalStore } from "react";

export type Lang = "ua" | "en";
const STORAGE_KEY = "acos.lang";

const dict = {
  ua: {
    // Header / nav
    "nav.brand": "Мій бренд",
    "nav.dashboard": "Панель",
    "nav.tenants": "Бренди (Admin)",
    "nav.signout": "Вийти",
    "nav.lang": "Мова",

    // Sidebar — owner
    "sb.cockpit": "Кокпіт",
    "sb.overview": "Огляд",
    "sb.revenue": "Виторг",
    "sb.growth": "Зростання",
    "sb.insights": "Інсайти",
    "sb.customers": "Клієнти",
    "sb.agents": "Агенти",
    "sb.setup": "Налаштування",
    "sb.channels": "Канали",
    "sb.onboarding": "Онбординг",
    "sb.storefront": "Вітрина",
    "sb.settings": "Параметри",

    // Sidebar — super-admin
    "sb.system": "Система",
    "sb.missionControl": "Командний центр",
    "sb.allTenants": "Усі бренди",
    "sb.liveRuns": "Запуски в ефірі",
    "sb.agentLibrary": "Бібліотека агентів",
    "sb.insightStream": "Потік інсайтів",
    "sb.brandLabel": "Бренд",

    // Header
    "hdr.booting": "Запуск кокпіта…",
    "hdr.superAdmin": "Супер-адмін",

    // Cockpit Hero
    "hero.revenue30": "Виторг · 30д",
    "hero.thisWeek": "цього тижня",
    "hero.aiAttributed": "Створено ШІ",
    "hero.ofRevenue": "виторгу",
    "hero.7d": "за 7д",
    "hero.autonomous": "АВТОНОМНО",
    "hero.conversion7": "Конверсія · 7д",
    "hero.converted": "повідомлень конвертовано з",
    "hero.customers": "Клієнти",
    "hero.active": "активні · стан агентів",

    // Brand page sections
    "brand.missionSubtitle": "Кокпіт місії · що зробив автономний флот, кого знає, скільки заробив.",
    "brand.live": "В ЕФІРІ",
    "brand.revenuePerf": "Виторг та продуктивність",
    "brand.autonomousFleet": "Автономний флот",
    "brand.customersChannels": "Клієнти та канали",
    "brand.noBrandTitle": "Бренд ще не створено",
    "brand.noBrandDesc": "У вас поки немає бренду. Попросіть супер-адміна створити його та призначити вас власником.",
    "brand.loadingBrand": "Завантаження бренду…",

    // Mission Control (admin)
    "mc.title": "Командний центр",
    "mc.subtitle": "Глобальний нагляд за всіма брендами, агентами та виторгом у реальному часі.",
    "mc.gmv30": "GMV · 30д",
    "mc.activeTenants": "Активні бренди",
    "mc.pendingActions": "Дії на схвалення",
    "mc.agentHealth": "Здоров'я агентів",
    "mc.insights24h": "Інсайти · 24г",
    "mc.totalCustomers": "Загалом клієнтів",
    "mc.runs24h": "Запуски агентів · 24г",
    "mc.crossTenantPulse": "Пульс по всіх брендах",
    "mc.leaderboard": "Лідерборд брендів",
    "mc.systemHealth": "Стан системи",
    "mc.viewAll": "Переглянути все",

    // Insights panel
    "insights.title": "Що ШІ знайшов для тебе",
    "insights.desc": "Автоматичні висновки агентів. Один клік — і дія застосована.",
    "insights.empty.title": "Все під контролем",
    "insights.empty.desc": "Нових інсайтів немає. Агенти працюють за розкладом.",
    "insights.apply": "Застосувати",
    "insights.dismiss": "Сховати",
    "insights.confidence": "впевненість",
    "insights.why": "Чому це важливо",
    "insights.what": "Що зробити",
    "insights.tech": "Технічні деталі",

    // Real-time toasts
    "toast.newInsight": "Новий інсайт",
    "toast.actionApplied": "Дію застосовано",
    "toast.agentCompleted": "Агент завершив роботу",

    // Onboarding wizard (existing keys preserved)
    "onb.title": "Швидкий старт за 7 кроків",
    "onb.subtitle": "Налаштуй свій автономний Revenue OS. Можна повернутись і дозаповнити пізніше.",
    "onb.step": "Крок",
    "onb.of": "з",
    "onb.next": "Далі",
    "onb.back": "Назад",
    "onb.skip": "Пропустити",
    "onb.finish": "Завершити та відкрити панель",
    "onb.completed": "Готово ✓",
    "onb.tip": "Підказка",
    "onb.s1.title": "Назва бренду",
    "onb.s1.desc": "Так твій бренд бачитимуть покупці у вітрині та повідомленнях бота.",
    "onb.s1.placeholder": "Напр. Coffee Lab",
    "onb.s2.title": "Канал зв'язку (Telegram)",
    "onb.s2.desc": "Бот спілкується з покупцями та відправляє нагадування. Створи бота через @BotFather, скопіюй токен — ми збережемо його шифровано.",
    "onb.s2.tokenLabel": "Bot token (опційно зараз — можна додати пізніше)",
    "onb.s2.help": "Як створити: 1) відкрий @BotFather у Telegram, 2) /newbot, 3) скопіюй токен сюди.",
    "onb.s3.title": "Перший продукт",
    "onb.s3.desc": "Хоча б один товар, щоб бот міг щось пропонувати. Деталі можна редагувати пізніше.",
    "onb.s3.namePh": "Напр. Espresso Blend 250g",
    "onb.s3.pricePh": "Ціна (USD)",
    "onb.s3.stockPh": "Залишок на складі",
    "onb.s4.title": "Імпорт клієнтів",
    "onb.s4.desc": "Завантаж CSV (email, name) — або скористайся демо-сидом, якщо тільки тестуєш.",
    "onb.s4.csv": "Завантажити CSV",
    "onb.s4.demo": "Засіяти демо-клієнтів",
    "onb.s4.csvHint": "Формат: перший рядок — заголовок 'email,name'.",
    "onb.s5.title": "Tracking-сніпет на сайт",
    "onb.s5.desc": "Встав цей рядок на свій сайт перед </body>. Ми починаємо бачити перегляди, кошики, покупки — без цього агенти працюватимуть тільки на історичних даних.",
    "onb.s5.copy": "Скопіювати сніпет",
    "onb.s5.copied": "Скопійовано ✓",
    "onb.s6.title": "Метод оплати",
    "onb.s6.desc": "Як покупці платитимуть. Поки можна обрати ручну оплату — пізніше підключимо Stripe.",
    "onb.s6.manual": "Ручна оплата (банк / готівка)",
    "onb.s6.stripe": "Stripe (підключимо пізніше)",
    "onb.s7.title": "Запросити команду",
    "onb.s7.desc": "Email колег, які допомагатимуть з брендом. Ми надішлемо їм запрошення (можна пропустити).",
    "onb.s7.emailPh": "colleague@example.com",
    "onb.s7.add": "Додати",
    "onb.s7.invited": "Запрошено",

    // Setup checklist
    "checklist.title": "Чек-лист налаштування",
    "checklist.desc": "Усі налаштування для запуску автономного Revenue OS на одному екрані.",
    "checklist.continue": "Продовжити налаштування",
    "checklist.allDone": "Усе готово — ШІ-агенти працюють у фоні 🚀",
    "checklist.s1": "Бренд створений",
    "checklist.s2": "Telegram-канал підключений",
    "checklist.s3": "Хоча б 1 товар у каталозі",
    "checklist.s4": "Імпортовано клієнтів",
    "checklist.s5": "Tracking-сніпет встановлений",
    "checklist.s6": "Метод оплати обраний",
    "checklist.s7": "Команда запрошена",

    // Generic
    "common.optional": "(не обов'язково)",
    "common.loading": "Завантаження…",
    "common.save": "Зберегти",
    "common.cancel": "Скасувати",

    // Public site — top nav
    "site.nav.how": "Як це працює",
    "site.nav.agents": "Агенти",
    "site.nav.pricing": "Ціни",
    "site.nav.signin": "Увійти",
    "site.nav.signup": "Спробувати",
    "site.nav.start": "Почати",

    // Home page
    "home.title": "ACOS — автономна команда зростання для вашого бренду",
    "home.metaDesc": "Підключіть свій магазин один раз. ШІ-агенти 24/7 шукають, де ви втрачаєте гроші, і пропонують готові дії — а ви натискаєте «Так».",
    "home.badge": "Автономна Revenue OS",
    "home.heroPre": "Це як мати команду маркетологів,",
    "home.heroAccent": "але вони працюють самі",
    "home.heroPost": "— а ви тільки кажете «так»",
    "home.heroSub": "Підключіть магазин — і розумні помічники почнуть стежити за клієнтами, складом, цінами та сайтом 24 години на добу. Як тільки знайдуть, де можна заробити більше, — покажуть вам кнопку. Один клік — і готово.",
    "home.heroCtaPrimary": "Почати безкоштовно",
    "home.heroCtaSecondary": "Увійти",
    "home.heroNote": "Без банківської картки · Працює з вашим існуючим магазином",
    "home.loops.eyebrow": "Помічники, які не сплять",
    "home.loops.title": "Кожен помічник стежить за своєю частиною бізнесу",
    "home.loops.subtitle": "Це не чат-бот і не ще одна панель з графіками. Це команда розумних помічників, які весь час шукають, де ваш магазин може заробити більше.",
    "home.loops.churnTitle": "Утримання клієнтів",
    "home.loops.churnDesc": "Помічає постійних покупців, які давно не повертались. Підказує, як їх повернути — м'яко і вчасно.",
    "home.loops.churnImpact": "+8–15% повернутих грошей",
    "home.loops.stockTitle": "Прогноз залишків",
    "home.loops.stockDesc": "Заздалегідь бачить, який товар скоро закінчиться. Підказує, що дозамовити, щоб не втратити продажі.",
    "home.loops.stockImpact": "Жодного «немає в наявності»",
    "home.loops.aovTitle": "Більший середній чек",
    "home.loops.aovDesc": "Знаходить, де клієнти кладуть менше у кошик, ніж могли б. Пропонує комплекти й апсейли.",
    "home.loops.aovImpact": "+5–12% до середнього чеку",
    "home.how.eyebrow": "Як це працює",
    "home.how.title": "Підключили один раз. Натиснули «Так». Заробляєте.",
    "home.how.s1Title": "Підключіть свої дані",
    "home.how.s1Desc": "Магазин, оплати, аналітика. Ми просто читаємо: замовлення, клієнти, відвідування.",
    "home.how.s2Title": "Помічники працюють 24/7",
    "home.how.s2Desc": "Кожен помічник стежить за своєю темою — клієнти, склад, ціни, SEO.",
    "home.how.s3Title": "Натискаєте «Так» одним кліком",
    "home.how.s3Desc": "Підказки приходять з очікуваним прибутком і впевненістю помічника. Рішення — за вами.",
    "home.how.s4Title": "Система вчиться",
    "home.how.s4Desc": "Те, що приносить гроші, — повторюється. Те, що ні, — більше не пропонується.",
    "home.why.eyebrow": "Чому ACOS",
    "home.why.title": "Ви керуєте. Система робить роботу.",
    "home.why.body": "Кожна дія чекає на ваш дозвіл — з прогнозом прибутку та оцінкою впевненості. ACOS ніколи не зніме гроші й не напише вашим клієнтам без вашого «так».",
    "home.why.multiTitle": "Кілька брендів — без плутанини",
    "home.why.multiDesc": "Ведіть скільки завгодно брендів. У кожного — свої дані, свої помічники, своя черга підтверджень.",
    "home.why.memTitle": "Памʼять, яка вчиться",
    "home.why.memDesc": "Те, що працює, — посилюється. Те, що ні, — блокується. Підлаштовується під ваш бренд автоматично.",
    "home.why.queueTitle": "Підтвердження, не автопілот",
    "home.why.queueDesc": "Один клік — погодити, відхилити чи підтвердити пакетом. Повний журнал. Ви завжди знаєте, що змінилось.",
    "home.why.shopTitle": "Можна без свого магазину",
    "home.why.shopDesc": "Ще немає сайту? Запустимо вам вітрину за хвилини. Або підключимо ваш Shopify.",
    "home.cta.title": "Перестаньте дивитись у графіки. Почніть схвалювати зростання.",
    "home.cta.body": "Налаштування першого бренду — менше пʼяти хвилин.",
    "home.cta.primary": "Розпочати",
    "home.cta.secondary": "Подивитись, як це працює",
    "home.footer.tag": "ACOS — Автономна Revenue OS",

    // How it works page
    "how.metaTitle": "Як працює ACOS — автономна Revenue OS для D2C-брендів",
    "how.metaDesc": "ACOS підключається до вашого магазину, запускає ШІ-помічників 24/7, ставить готові дії на ваше підтвердження та вчиться на результатах. Подивіться, як це працює.",
    "how.badge": "Автономний цикл",
    "how.title": "Як ACOS перетворює дані вашого магазину на схвалений прибуток",
    "how.subtitle": "ACOS — це не чат і не ще одна панель з графіками. Це автономний цикл: підключити → знайти → погодити → навчитись. З кожним колом система стає розумнішою саме під ваш бренд.",
    "how.ctaStart": "Почати безкоштовно",
    "how.ctaAgents": "Подивитись помічників",
    "how.s1.title": "1. Підключіть дані один раз",
    "how.s1.p1": "Магазин, оплати, аналітика, пошта",
    "how.s1.p2": "ACOS читає замовлення, клієнтів, події, склад і трафік",
    "how.s1.p3": "Кілька брендів одразу — повністю окремі дані",
    "how.s2.title": "2. Помічники працюють 24/7",
    "how.s2.p1": "Утримання клієнтів — помічає, хто давно не повертався",
    "how.s2.p2": "Залишки — рахує, на скільки днів вистачить кожного товару",
    "how.s2.p3": "Середній чек — знаходить, де клієнти не докладають у кошик",
    "how.s2.p4": "Пошук — показує, що люди шукають, але не знаходять",
    "how.s3.title": "3. Підтверджуєте одним кліком",
    "how.s3.p1": "Кожна підказка показує очікуваний прибуток і впевненість",
    "how.s3.p2": "Погодьте, відхиліть або скасуйте — повний журнал дій",
    "how.s3.p3": "ACOS не зніме гроші й не напише клієнту без вашого «так»",
    "how.s4.title": "4. Памʼять вчиться",
    "how.s4.p1": "Через 7 днів результат повертається у систему",
    "how.s4.p2": "Те, що приносить прибуток, — повторюється для вашого бренду",
    "how.s4.p3": "Те, що не спрацювало, — більше не пропонується",
    "how.compound.title": "Ефект, що накопичується",
    "how.compound.desc": "Кожне «так» — це доказ. Кожен виміряний результат — це урок. За кілька тижнів система пропонує тільки те, що реально приносить прибуток саме вашому бренду.",
    "how.bottom.title": "Готові поставити бренд на автопілот — з вами за штурвалом?",
    "how.bottom.viewPrices": "Подивитись ціни",

    // Agents page
    "ag.metaTitle": "Помічники ACOS — клієнти, склад, чек, пошук",
    "ag.metaDesc": "Постійно працюючі помічники ACOS: утримання клієнтів, прогноз залишків, середній чек і прогалини в пошуку. Кожен пояснює свої поради й показує очікуваний прибуток.",
    "ag.badge": "Каталог помічників",
    "ag.title": "Чотири помічники. Один цикл прибутку.",
    "ag.subtitle": "Кожен помічник пояснює: який сигнал спрацював, що пропонує зробити та наскільки впевнений. Рішення завжди за вами.",
    "ag.signals": "Сигнали",
    "ag.action": "Дія в один клік",
    "ag.runOnStore": "Запустити цих помічників у моєму магазині",
    "ag.churnName": "Утримання клієнтів",
    "ag.churnSummary": "Стежить за постійними покупцями (4+ оплачені замовлення). Якщо хтось мовчить у 1.5 раза довше, ніж зазвичай, і вже понад 14 днів — позначає як «скоро піде».",
    "ag.churnImpact": "Повертає 8–15% прибутку від клієнтів, які майже зникли.",
    "ag.churnAct": "Привітальне повідомлення зі знижкою −15%",
    "ag.stockName": "Прогноз залишків",
    "ag.stockSummary": "Рахує швидкість продажу кожного товару за останні 14 днів і прогнозує, на скільки днів вистачить. Попереджає, коли залишилось менше 7 днів.",
    "ag.stockImpact": "Захищає від втрачених продажів — економить 3–7% прибутку.",
    "ag.stockAct": "Запит на дозамовлення на 30 днів",
    "ag.aovName": "Покинуті кошики",
    "ag.aovSummary": "Дивиться, де клієнт додав товар у кошик, але не оплатив. Групує по товарах і показує, скільки грошей можна повернути.",
    "ag.aovImpact": "Повертає ~25% покинутих кошиків нагадуванням і знижкою −10%.",
    "ag.aovAct": "Лист про покинутий кошик",
    "ag.searchName": "Прогалини у пошуку",
    "ag.searchSummary": "Шукає на сайті запити, які нічого не знайшли за останні 30 днів. Позначає ті, де порожньо понад 50% разів і шукали хоча б 3 рази.",
    "ag.searchImpact": "Ловить попит, який вже є — перетворює на нову сторінку або новий товар.",
    "ag.searchAct": "Створити SEO-сторінку",

    // Pricing page
    "pr.metaTitle": "Ціни ACOS — плани автономної Revenue OS",
    "pr.metaDesc": "Прості ціни — платите, коли ACOS приносить прибуток. Почніть безкоштовно, далі — за бренд і за прийняту підказку. Без контрактів і мінімумів.",
    "pr.badge": "Ціни",
    "pr.title": "Платите тоді, коли ACOS вже заробив",
    "pr.subtitle": "У кожному плані — повний набір помічників, черга підтверджень і памʼять. Почніть безкоштовно, масштабуйтесь за брендом.",
    "pr.popular": "Найпопулярніший",
    "pr.note": "Банківська картка не потрібна. Скасувати можна будь-коли. Ізоляція даних між брендами — у кожному плані.",
    "pr.pilotName": "Пілот",
    "pr.pilotPrice": "0 ₴",
    "pr.pilotCadence": "безкоштовно 14 днів",
    "pr.pilotDesc": "Підключіть один бренд, запустіть усіх помічників, погодьте до 25 підказок.",
    "pr.pilotF1": "1 бренд",
    "pr.pilotF2": "Усі 4 помічники ACOS",
    "pr.pilotF3": "Черга підтверджень + журнал дій",
    "pr.pilotF4": "Щоденний запуск помічників",
    "pr.pilotCta": "Почати безкоштовно",
    "pr.growthName": "Зростання",
    "pr.growthPrice": "199 $",
    "pr.growthCadence": "за бренд / місяць",
    "pr.growthDesc": "Для активних D2C-брендів. Без обмежень на підказки, памʼять, що вчиться, та повідомлення на різних каналах.",
    "pr.growthF1": "Без обмежень на підказки і дії",
    "pr.growthF2": "Памʼять, що вчиться (авто-настройка)",
    "pr.growthF3": "Email-канал для повернення клієнтів і кошиків",
    "pr.growthF4": "Сповіщення у Slack і Webhook",
    "pr.growthF5": "Пріоритетна підтримка",
    "pr.growthCta": "Почати пробний період",
    "pr.portName": "Портфоліо",
    "pr.portPrice": "Індивідуально",
    "pr.portCadence": "для агенцій і груп брендів",
    "pr.portDesc": "Керуйте 5+ брендами з єдиного центру. Можна під своїм брендом і з власними помічниками на замовлення.",
    "pr.portF1": "5+ брендів зі спільною панеллю",
    "pr.portF2": "Помічники на замовлення",
    "pr.portF3": "Білий лейбл (під вашим брендом)",
    "pr.portF4": "Персональний інженер успіху",
    "pr.portCta": "Звʼязатись з нами",

    // Login / signup
    "auth.signinTitle": "Вхід",
    "auth.signinDesc": "Увійдіть до ACOS через Google.",
    "auth.signupTitle": "Створення акаунту",
    "auth.signupDesc": "Створіть акаунт ACOS через Google за секунду.",
    "auth.continueGoogle": "Продовжити через Google",
    "auth.signupGoogle": "Зареєструватись через Google",
    "auth.redirecting": "Перенаправлення…",
    "auth.noAccount": "Немає акаунту?",
    "auth.hasAccount": "Вже маєте акаунт?",
    "auth.create": "Створити",
    "auth.signin": "Увійти",
    "auth.welcome": "Вітаємо!",
    "auth.failGoogle": "Не вдалось увійти через Google",
    "auth.failSignupGoogle": "Не вдалось зареєструватись через Google",
    "auth.fail": "Не вдалось увійти",
    "auth.failSignup": "Не вдалось зареєструватись",
    "auth.created": "Акаунт створено",
  },
  en: {
    "nav.brand": "My brand",
    "nav.dashboard": "Dashboard",
    "nav.tenants": "Tenants (Admin)",
    "nav.signout": "Sign out",
    "nav.lang": "Language",

    "sb.cockpit": "Cockpit",
    "sb.overview": "Overview",
    "sb.revenue": "Revenue",
    "sb.growth": "Growth",
    "sb.insights": "Insights",
    "sb.customers": "Customers",
    "sb.agents": "Agents",
    "sb.setup": "Setup",
    "sb.channels": "Channels",
    "sb.onboarding": "Onboarding",
    "sb.storefront": "Storefront",
    "sb.settings": "Settings",
    "sb.system": "System",
    "sb.missionControl": "Mission Control",
    "sb.allTenants": "All tenants",
    "sb.liveRuns": "Live runs",
    "sb.agentLibrary": "Agent library",
    "sb.insightStream": "Insight stream",
    "sb.brandLabel": "Brand",

    "hdr.booting": "Booting cockpit…",
    "hdr.superAdmin": "Super-admin",

    "hero.revenue30": "Revenue · 30d",
    "hero.thisWeek": "this week",
    "hero.aiAttributed": "AI-attributed",
    "hero.ofRevenue": "of revenue",
    "hero.7d": "7d",
    "hero.autonomous": "AUTONOMOUS",
    "hero.conversion7": "Conversion · 7d",
    "hero.converted": "messages converted of",
    "hero.customers": "Customers",
    "hero.active": "active · agent health",

    "brand.missionSubtitle": "Mission cockpit · what the autonomous fleet did, who it knows, what it earned.",
    "brand.live": "LIVE",
    "brand.revenuePerf": "Revenue performance",
    "brand.autonomousFleet": "Autonomous fleet",
    "brand.customersChannels": "Customers & channels",
    "brand.noBrandTitle": "No brand yet",
    "brand.noBrandDesc": "You don't own a brand yet. Ask a super-admin to create one and assign you as owner.",
    "brand.loadingBrand": "Loading brand…",

    "mc.title": "Mission Control",
    "mc.subtitle": "Global oversight of every brand, agent and revenue stream — in real time.",
    "mc.gmv30": "GMV · 30d",
    "mc.activeTenants": "Active tenants",
    "mc.pendingActions": "Pending actions",
    "mc.agentHealth": "Agent health",
    "mc.insights24h": "Insights · 24h",
    "mc.totalCustomers": "Total customers",
    "mc.runs24h": "Agent runs · 24h",
    "mc.crossTenantPulse": "Cross-tenant pulse",
    "mc.leaderboard": "Tenant leaderboard",
    "mc.systemHealth": "System health",
    "mc.viewAll": "View all",

    "insights.title": "What the AI found for you",
    "insights.desc": "Auto-generated findings from your agents. One click to act.",
    "insights.empty.title": "All clear",
    "insights.empty.desc": "No new insights. Agents run on schedule.",
    "insights.apply": "Apply",
    "insights.dismiss": "Dismiss",
    "insights.confidence": "confident",
    "insights.why": "Why it matters",
    "insights.what": "What to do",
    "insights.tech": "Technical details",

    "toast.newInsight": "New insight",
    "toast.actionApplied": "Action applied",
    "toast.agentCompleted": "Agent completed",

    "onb.title": "7-step quick start",
    "onb.subtitle": "Set up your autonomous Revenue OS. You can come back to finish anytime.",
    "onb.step": "Step",
    "onb.of": "of",
    "onb.next": "Next",
    "onb.back": "Back",
    "onb.skip": "Skip",
    "onb.finish": "Finish & open dashboard",
    "onb.completed": "Done ✓",
    "onb.tip": "Tip",
    "onb.s1.title": "Brand name",
    "onb.s1.desc": "How customers see your brand in the storefront and bot messages.",
    "onb.s1.placeholder": "e.g. Coffee Lab",
    "onb.s2.title": "Channel (Telegram)",
    "onb.s2.desc": "Your bot talks to customers and sends nudges. Create one via @BotFather, paste the token — we store it encrypted.",
    "onb.s2.tokenLabel": "Bot token (optional now — can add later)",
    "onb.s2.help": "How to: 1) open @BotFather, 2) /newbot, 3) paste the token here.",
    "onb.s3.title": "First product",
    "onb.s3.desc": "At least one product so the bot has something to offer. Edit details later.",
    "onb.s3.namePh": "e.g. Espresso Blend 250g",
    "onb.s3.pricePh": "Price (USD)",
    "onb.s3.stockPh": "Stock on hand",
    "onb.s4.title": "Import customers",
    "onb.s4.desc": "Upload a CSV (email, name) — or use a demo seed if you're just testing.",
    "onb.s4.csv": "Upload CSV",
    "onb.s4.demo": "Seed demo customers",
    "onb.s4.csvHint": "Format: header row 'email,name'.",
    "onb.s5.title": "Tracking snippet",
    "onb.s5.desc": "Paste this on your site before </body>. We start seeing views, carts, purchases — without it agents only see historical data.",
    "onb.s5.copy": "Copy snippet",
    "onb.s5.copied": "Copied ✓",
    "onb.s6.title": "Payment method",
    "onb.s6.desc": "How customers pay. Manual is fine to start — Stripe can be wired later.",
    "onb.s6.manual": "Manual (bank / cash)",
    "onb.s6.stripe": "Stripe (connect later)",
    "onb.s7.title": "Invite teammates",
    "onb.s7.desc": "Emails of people who'll help run the brand. We'll send invites (skip is fine).",
    "onb.s7.emailPh": "colleague@example.com",
    "onb.s7.add": "Add",
    "onb.s7.invited": "Invited",

    "checklist.title": "Setup checklist",
    "checklist.desc": "Everything you need to launch the autonomous Revenue OS — in one place.",
    "checklist.continue": "Continue setup",
    "checklist.allDone": "All set — AI agents are running in the background 🚀",
    "checklist.s1": "Brand created",
    "checklist.s2": "Telegram channel connected",
    "checklist.s3": "At least 1 product",
    "checklist.s4": "Customers imported",
    "checklist.s5": "Tracking snippet installed",
    "checklist.s6": "Payment method chosen",
    "checklist.s7": "Team invited",

    "common.optional": "(optional)",
    "common.loading": "Loading…",
    "common.save": "Save",
    "common.cancel": "Cancel",
  },
} satisfies Record<Lang, Record<string, string>>;

export type TKey = keyof (typeof dict)["ua"];

let current: Lang = "ua";
const listeners = new Set<() => void>();

function readInitial(): Lang {
  if (typeof window === "undefined") return "ua";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "en" || saved === "ua" ? saved : "ua";
}

if (typeof window !== "undefined") {
  current = readInitial();
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, lang);
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook — компоненти автоматично перерендерюються при зміні мови. */
export function useT() {
  const lang = useSyncExternalStore(subscribe, () => current, () => "ua" as Lang);
  return {
    lang,
    setLang,
    t: (key: TKey, fallback?: string) => dict[lang][key] ?? fallback ?? key,
  };
}

/** Чистий helper (для не-React коду). */
export function tStatic(key: TKey, lang: Lang = current): string {
  return dict[lang][key] ?? key;
}
