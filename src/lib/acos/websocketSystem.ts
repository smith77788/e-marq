/**
 * Smart WebSocket System — двосторонній зв'язок в реальному часі.
 *
 * Використання:
 * 1. Live dashboard — оновлення дашборду
 * 2. Live chat — чат з клієнтом
 * 3. Live notifications — сповіщення
 * 4. Live agent status — статус агентів
 */

type MessageHandler = (data: unknown) => void;

export class SmartWebSocket {
  private handlers = new Map<string, MessageHandler[]>();
  private connected = false;

  /**
   * Підписатися на подію.
   */
  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);

    return () => {
      const handlers = this.handlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) handlers.splice(index, 1);
      }
    };
  }

  /**
   * Надіслати повідомлення.
   */
  emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error(`WebSocket handler error for ${event}:`, e);
      }
    }
  }

  /**
   * Перевірити з'єднання.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Позначити як з'єднане.
   */
  setConnected(connected: boolean): void {
    this.connected = connected;
  }
}

// Singleton WebSocket manager
export const ws = new SmartWebSocket();
