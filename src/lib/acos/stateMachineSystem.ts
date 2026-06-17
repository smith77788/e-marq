/**
 * Smart State Machine — автомат станів для бізнес-процесів.
 *
 * Використання:
 * 1. Order lifecycle — життєвий цикл замовлення
 * 2. Payment flow — процес оплати
 * 3. Agent execution — виконання агентів
 */

export type StateTransition<T extends string> = {
  from: T;
  to: T;
  guard?: () => boolean;
  action?: () => void | Promise<void>;
};

export class StateMachine<T extends string> {
  private currentState: T;
  private transitions: StateTransition<T>[];
  private history: Array<{ from: T; to: T; timestamp: number }> = [];

  constructor(initialState: T, transitions: StateTransition<T>[]) {
    this.currentState = initialState;
    this.transitions = transitions;
  }

  /**
   * Перейти в новий стан.
   */
  async transition(to: T): Promise<boolean> {
    const transition = this.transitions.find(
      (t) => t.from === this.currentState && t.to === to,
    );

    if (!transition) {
      return false;
    }

    if (transition.guard && !transition.guard()) {
      return false;
    }

    if (transition.action) {
      await transition.action();
    }

    this.history.push({
      from: this.currentState,
      to,
      timestamp: Date.now(),
    });

    this.currentState = to;
    return true;
  }

  /**
   * Отримати поточний стан.
   */
  getState(): T {
    return this.currentState;
  }

  /**
   * Отримати доступні переходи.
   */
  getAvailableTransitions(): T[] {
    return this.transitions
      .filter((t) => t.from === this.currentState)
      .map((t) => t.to);
  }

  /**
   * Отримати історію переходів.
   */
  getHistory(): Array<{ from: T; to: T; timestamp: number }> {
    return [...this.history];
  }

  /**
   * Скинути в початковий стан.
   */
  reset(initialState: T): void {
    this.currentState = initialState;
    this.history = [];
  }
}

/**
 * Приклад: Order lifecycle
 */
export type OrderState = "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled";

export function createOrderStateMachine(): StateMachine<OrderState> {
  return new StateMachine<OrderState>("pending", [
    { from: "pending", to: "paid" },
    { from: "pending", to: "cancelled" },
    { from: "paid", to: "processing" },
    { from: "paid", to: "cancelled" },
    { from: "processing", to: "shipped" },
    { from: "shipped", to: "delivered" },
  ]);
}
