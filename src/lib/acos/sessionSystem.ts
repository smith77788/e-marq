/**
 * Smart API Session — керування сесіями.
 *
 * Функції:
 * 1. Створення сесій
 * 2. Оновлення сесій
 * 3. Завершення сесій
 * 4. Перевірка терміну дії
 */

export type Session = {
  id: string;
  userId: string;
  tenantId?: string;
  createdAt: number;
  expiresAt: number;
  lastActivity: number;
  ipAddress?: string;
  userAgent?: string;
};

const sessions = new Map<string, Session>();

/**
 * Створити сесію.
 */
export function createSession(
  userId: string,
  options?: {
    tenantId?: string;
    ipAddress?: string;
    userAgent?: string;
    ttlMs?: number;
  },
): Session {
  const id = crypto.randomUUID();
  const now = Date.now();
  const ttl = options?.ttlMs ?? 24 * 60 * 60 * 1000; // 24 години

  const session: Session = {
    id,
    userId,
    tenantId: options?.tenantId,
    createdAt: now,
    expiresAt: now + ttl,
    lastActivity: now,
    ipAddress: options?.ipAddress,
    userAgent: options?.userAgent,
  };

  sessions.set(id, session);
  return session;
}

/**
 * Отримати сесію.
 */
export function getSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }

  session.lastActivity = Date.now();
  return session;
}

/**
 * Завершити сесію.
 */
export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/**
 * Очистити протерміновані сесії.
 */
export function cleanupSessions(): number {
  const now = Date.now();
  let count = 0;

  for (const [id, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(id);
      count++;
    }
  }

  return count;
}

/**
 * Отримати кількість активних сесій.
 */
export function getActiveSessionCount(): number {
  cleanupSessions();
  return sessions.size;
}
