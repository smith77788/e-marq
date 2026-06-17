/**
 * Smart Message Queue — черга повідомлень для асинхронної обробки.
 *
 * Типи:
 * 1. FIFO — першим прийшов, першим обслуговується
 * 2. Priority — за пріоритетом
 * 3. Delayed — відкладені повідомлення
 */

export type Message<T = unknown> = {
  id: string;
  payload: T;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  processAt: number;
};

export class MessageQueue<T = unknown> {
  private queue: Message<T>[] = [];
  private handlers = new Map<string, (payload: T) => Promise<void>>();
  private processing = false;

  /**
   * Додати повідомлення в чергу.
   */
  enqueue(
    payload: T,
    options?: { priority?: number; delayMs?: number; maxAttempts?: number },
  ): string {
    const id = crypto.randomUUID().slice(0, 8);
    const message: Message<T> = {
      id,
      payload,
      priority: options?.priority ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      createdAt: Date.now(),
      processAt: Date.now() + (options?.delayMs ?? 0),
    };

    this.queue.push(message);
    this.queue.sort((a, b) => b.priority - a.priority || a.processAt - b.processAt);

    return id;
  }

  /**
   * Зареєструвати обробник.
   */
  on(event: string, handler: (payload: T) => Promise<void>): void {
    this.handlers.set(event, handler);
  }

  /**
   * Обробити наступне повідомлення.
   */
  async processNext(): Promise<boolean> {
    if (this.processing) return false;

    const now = Date.now();
    const message = this.queue.find(
      (m) => m.processAt <= now && m.attempts < m.maxAttempts,
    );

    if (!message) return false;

    this.processing = true;
    message.attempts++;

    try {
      const handler = this.handlers.get("default");
      if (handler) {
        await handler(message.payload);
      }
      this.queue = this.queue.filter((m) => m.id !== message.id);
    } catch (error) {
      console.error(`Message ${message.id} failed:`, error);
      if (message.attempts >= message.maxAttempts) {
        this.queue = this.queue.filter((m) => m.id !== message.id);
      }
    } finally {
      this.processing = false;
    }

    return true;
  }

  /**
   * Отримати розмір черги.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Очистити чергу.
   */
  clear(): void {
    this.queue = [];
  }
}
