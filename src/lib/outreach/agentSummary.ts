/**
 * Перетворює технічну відповідь outreach-агента на людську українську фразу.
 * Замість сирого JSON у тості користувач бачить, що саме сталось і що робити далі.
 */

const SKIP_REASONS: Record<string, string> = {
  instagram_inactive: "Instagram вимкнено в налаштуваннях outreach.",
  telegram_inactive: "Telegram вимкнено в налаштуваннях outreach.",
  channel_disabled: "Канал вимкнено в налаштуваннях outreach.",
  channels_inactive: "Жоден канал outreach не активований.",
  no_subreddits: "У налаштуваннях немає сабреддітів для пошуку.",
  no_rss_bridge: "Не налаштовано міст для Instagram (потрібен ключ INSTAGRAM_RSS_URL у секретах).",
  no_keywords: "У налаштуваннях немає ключових слів.",
  no_active_channels: "Жоден канал не активований.",
};

const AGENT_LABELS: Record<string, string> = {
  "outreach-reddit-hunter": "Reddit пошук",
  "outreach-google-hunter": "Google пошук",
  "outreach-telegram-hunter": "Telegram пошук",
  "outreach-instagram-hunter": "Instagram пошук",
  "outreach-composer": "Composer",
  "outreach-quality-scorer": "Quality scorer",
  "outreach-roi-collector": "ROI collector",
  "outreach-self-heal": "Self-heal",
  "outreach-action-executor": "Постинг",
  "web-prospector": "Web Prospector",
  "social-engager": "Social Engager",
  "content-magnet": "Content Magnet",
};

export function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

type TenantSummary = {
  stats?: Record<string, number>;
  skipped?: string;
  errors?: string[];
  hint?: string;
  created?: number;
  scheduled?: number;
  examined?: number;
  rescheduled?: number;
};

type AgentResponse = {
  tenants?: number;
  summary?: Record<string, TenantSummary | unknown>;
  created?: number;
  scanned?: number;
  seeded?: number;
  per_brand?: Record<string, number>;
  per_tenant?: Record<string, { queries?: number; hits?: number }>;
  note?: string;
  [key: string]: unknown;
};

/**
 * Дає коротку людську фразу для toast-опису.
 * Приклади:
 *   - "Знайдено 5 нових дописів у 2 проєктах"
 *   - "Instagram вимкнено в налаштуваннях outreach (3 проєкти)"
 *   - "0 нових дописів — спробуйте додати ключові слова"
 */
export function friendlyAgentSummary(_agent: string, raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return "Агент відпрацював.";
  }
  const data = raw as AgentResponse;

  // Top-level created (web-prospector / social-engager / content-magnet)
  if (typeof data.created === "number" && !data.summary) {
    const parts: string[] = [];
    if (data.created === 0) {
      parts.push(
        data.note ??
          "Нічого нового не знайдено цього разу. Спробуйте пізніше або змініть тематику бренду.",
      );
    } else {
      parts.push(
        `Створено ${data.created} ${pluralUk(data.created, "запис", "записи", "записів")}.`,
      );
    }
    if (typeof data.tenants === "number" && data.tenants > 0) {
      parts.push(
        `Опрацьовано ${data.tenants} ${pluralUk(data.tenants, "бренд", "бренди", "брендів")}.`,
      );
    }
    if (data.per_brand && Object.keys(data.per_brand).length > 0) {
      const top = Object.entries(data.per_brand)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([brand, n]) => `${brand} — ${n}`)
        .join(", ");
      parts.push(`Розподіл: ${top}.`);
    }
    return parts.join(" ");
  }

  const summary = (data.summary ?? {}) as Record<string, TenantSummary>;
  const tenantIds = Object.keys(summary);
  const totalTenants = tenantIds.length || data.tenants || 0;

  if (totalTenants === 0) {
    return "Не знайдено жодного проєкту, у якому можна запустити агента. Перевірте налаштування outreach.";
  }

  // Зведена статистика
  let totalCreated = 0;
  let totalSeen = 0;
  let totalErrors = 0;
  const skipReasons = new Map<string, number>();
  const hints = new Set<string>();

  for (const t of tenantIds) {
    const s = summary[t] ?? {};
    if (s.skipped) {
      skipReasons.set(s.skipped, (skipReasons.get(s.skipped) ?? 0) + 1);
      if (s.hint) hints.add(s.hint);
      continue;
    }
    const stats = s.stats ?? {};
    totalCreated +=
      (stats.created ?? 0) + (stats.inserted ?? 0) + (s.created ?? 0) + (s.scheduled ?? 0);
    totalSeen += (stats.seen ?? 0) + (stats.scanned ?? 0) + (s.examined ?? 0);
    totalErrors += s.errors?.length ?? 0;
  }

  const activeTenants = totalTenants - Array.from(skipReasons.values()).reduce((a, b) => a + b, 0);

  // Якщо взагалі всі пропустили
  if (activeTenants === 0 && skipReasons.size > 0) {
    const parts: string[] = [];
    for (const [reason, count] of skipReasons) {
      const label = SKIP_REASONS[reason] ?? `Пропущено: ${reason}.`;
      parts.push(`${label} (${count} ${pluralUk(count, "проєкт", "проєкти", "проєктів")})`);
    }
    if (hints.size > 0) parts.push(...hints);
    return parts.join(" ");
  }

  // Гібрид: частина працювала, частина пропустила
  const lines: string[] = [];
  if (totalCreated > 0) {
    lines.push(
      `Знайдено ${totalCreated} ${pluralUk(totalCreated, "новий запис", "нові записи", "нових записів")}` +
        (activeTenants > 1
          ? ` у ${activeTenants} ${pluralUk(activeTenants, "проєкті", "проєктах", "проєктах")}`
          : ""),
    );
  } else if (totalSeen > 0) {
    lines.push(
      `Переглянуто ${totalSeen} ${pluralUk(totalSeen, "джерело", "джерела", "джерел")}, нових збігів немає.`,
    );
  } else if (activeTenants > 0) {
    lines.push("Агент відпрацював, але не знайшов нових збігів.");
  }

  if (skipReasons.size > 0) {
    const skipParts: string[] = [];
    for (const [reason, count] of skipReasons) {
      const label = SKIP_REASONS[reason] ?? `пропущено (${reason})`;
      skipParts.push(`${label.replace(/\.$/, "")} — ${count}`);
    }
    lines.push(`Пропущено: ${skipParts.join("; ")}.`);
  }

  if (totalErrors > 0) {
    lines.push(
      `${totalErrors} ${pluralUk(totalErrors, "помилка", "помилки", "помилок")} під час обробки (відкрийте список, щоб побачити деталі).`,
    );
  }

  return lines.join(" ") || "Агент відпрацював.";
}

function pluralUk(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Перетворює помилку від fetch у людське пояснення. */
export function friendlyAgentError(message: string): string {
  if (!message) return "Не вдалося запустити агента. Спробуйте ще раз за хвилину.";
  if (/401|unauthor/i.test(message)) return "Сесія завершилась. Увійдіть знову та повторіть.";
  if (/403|forbid/i.test(message))
    return "Немає прав на запуск цього агента. Зверніться до власника проєкту.";
  if (/404|not.found/i.test(message))
    return "Цього агента не знайдено на сервері. Можливо, він тимчасово вимкнений.";
  if (/429|rate/i.test(message))
    return "Забагато запитів за короткий час. Зачекайте хвилину і спробуйте знову.";
  if (/500|502|503|504|timeout|fetch/i.test(message))
    return "Сервер агента тимчасово недоступний. Спробуйте за хвилину.";
  if (/no.*tenant|empty.*tenants/i.test(message))
    return "Немає жодного проєкту, до якого можна застосувати агента.";
  return message;
}
