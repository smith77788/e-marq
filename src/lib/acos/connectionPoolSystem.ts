/**
 * Smart Connection Pool — пул з'єднань для бази даних та зовнішніх сервісів.
 *
 * Функції:
 * 1. Connection management
 * 2. Pool size control
 * 3. Connection reuse
 * 4. Health monitoring
 */

export type Connection = {
  id: string;
  createdAt: number;
  lastUsed: number;
  inUse: boolean;
};

export class ConnectionPool {
  private connections: Connection[] = [];
  private maxSize: number;
  private minSize: number;
  private idleTimeout: number;

  constructor(options: {
    maxSize?: number;
    minSize?: number;
    idleTimeout?: number;
  } = {}) {
    this.maxSize = options.maxSize ?? 10;
    this.minSize = options.minSize ?? 2;
    this.idleTimeout = options.idleTimeout ?? 300_000; // 5 minutes
  }

  /**
   * Отримати з'єднання з пулу.
   */
  async acquire(): Promise<Connection> {
    // Знайти вільне з'єднання
    const available = this.connections.find((c) => !c.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }

    // Створити нове якщо є місце
    if (this.connections.length < this.maxSize) {
      const conn: Connection = {
        id: crypto.randomUUID().slice(0, 8),
        createdAt: Date.now(),
        lastUsed: Date.now(),
        inUse: true,
      };
      this.connections.push(conn);
      return conn;
    }

    // Чекати на вільне з'єднання
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const free = this.connections.find((c) => !c.inUse);
        if (free) {
          clearInterval(check);
          free.inUse = true;
          free.lastUsed = Date.now();
          resolve(free);
        }
      }, 100);
    });
  }

  /**
   * Повернути з'єднання в пул.
   */
  release(connection: Connection): void {
    connection.inUse = false;
    connection.lastUsed = Date.now();
  }

  /**
   * Очистити прострочені з'єднання.
   */
  cleanup(): number {
    const now = Date.now();
    const before = this.connections.length;

    this.connections = this.connections.filter(
      (c) => !c.inUse && now - c.lastUsed < this.idleTimeout,
    );

    return before - this.connections.length;
  }

  /**
   * Отримати статистику пулу.
   */
  getStats(): {
    total: number;
    active: number;
    idle: number;
    utilization: number;
  } {
    const active = this.connections.filter((c) => c.inUse).length;
    return {
      total: this.connections.length,
      active,
      idle: this.connections.length - active,
      utilization: this.connections.length > 0 ? (active / this.connections.length) * 100 : 0,
    };
  }
}
