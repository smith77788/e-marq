/**
 * Smart Pub/Sub — система публікації та підписки на події.
 *
 * Функції:
 * 1. Topic-based pub/sub
 * 2. Wildcard subscriptions
 * 3. Message filtering
 * 4. Dead letter queue
 */

type MessageHandler<T = unknown> = (topic: string, payload: T) => void | Promise<void>;

export class PubSub {
  private subscribers = new Map<string, MessageHandler[]>();
  private deadLetterQueue: Array<{ topic: string; payload: unknown; error: string; timestamp: number }> = [];

  /**
   * Підписатися на топік.
   */
  subscribe<T = unknown>(topic: string, handler: MessageHandler<T>): () => void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    this.subscribers.get(topic)!.push(handler as MessageHandler);

    return () => {
      const handlers = this.subscribers.get(topic);
      if (handlers) {
        const index = handlers.indexOf(handler as MessageHandler);
        if (index > -1) handlers.splice(index, 1);
      }
    };
  }

  /**
   * Підписатися на всі топіки (wildcard).
   */
  subscribeAll<T = unknown>(handler: MessageHandler<T>): () => void {
    return this.subscribe("*", handler as MessageHandler);
  }

  /**
   * Опублікувати повідомлення.
   */
  async publish<T = unknown>(topic: string, payload: T): Promise<void> {
    // Exact match handlers
    const exactHandlers = this.subscribers.get(topic) ?? [];

    // Wildcard handlers
    const wildcardHandlers = this.subscribers.get("*") ?? [];

    const allHandlers = [...exactHandlers, ...wildcardHandlers];

    for (const handler of allHandlers) {
      try {
        await handler(topic, payload);
      } catch (error) {
        this.deadLetterQueue.push({
          topic,
          payload,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Отримати чергу мертвих листів.
   */
  getDeadLetterQueue(): Array<{
    topic: string;
    payload: unknown;
    error: string;
    timestamp: number;
  }> {
    return [...this.deadLetterQueue];
  }

  /**
   * Очистити чергу мертвих листів.
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
  }

  /**
   * Отримати кількість підписників на топік.
   */
  subscriberCount(topic: string): number {
    return this.subscribers.get(topic)?.length ?? 0;
  }
}
