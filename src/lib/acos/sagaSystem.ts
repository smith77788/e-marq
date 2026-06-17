/**
 * Smart Saga — оркестрація складних транзакцій.
 *
 * Патерн Saga:
 * 1. Choreography — децентралізована оркестрація
 * 2. Orchestration — централізована оркестрація
 * 3. Compensation — компенсаційні дії
 */

export type SagaStep<T = unknown> = {
  name: string;
  execute: (context: T) => Promise<void>;
  compensate: (context: T) => Promise<void>;
};

export type SagaResult = {
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
};

export class Saga<T = Record<string, unknown>> {
  private steps: SagaStep<T>[] = [];

  /**
   * Додати крок до саги.
   */
  addStep(step: SagaStep<T>): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Виконати сагу.
   */
  async execute(context: T): Promise<SagaResult> {
    const completedSteps: string[] = [];

    for (const step of this.steps) {
      try {
        await step.execute(context);
        completedSteps.push(step.name);
      } catch (error) {
        // Компенсувати попередні кроки
        for (let i = completedSteps.length - 1; i >= 0; i--) {
          try {
            await this.steps[i].compensate(context);
          } catch (compensationError) {
            console.error(`Compensation failed for ${this.steps[i].name}:`, compensationError);
          }
        }

        return {
          success: false,
          completedSteps,
          failedStep: step.name,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return { success: true, completedSteps };
  }
}

/**
 * Приклад: Checkout Saga
 */
export function createCheckoutSaga(): Saga<{
  orderId: string;
  items: Array<{ productId: string; quantity: number }>;
  paymentMethod: string;
}> {
  return new Saga()
    .addStep({
      name: "validate_order",
      execute: async (ctx) => {
        // Валідувати замовлення
        console.log(`Validating order ${ctx.orderId}`);
      },
      compensate: async () => {
        // Нічого робити — валідація не змінює стан
      },
    })
    .addStep({
      name: "reserve_stock",
      execute: async (ctx) => {
        // Зарезервувати товари
        console.log(`Reserving stock for ${ctx.items.length} items`);
      },
      compensate: async (ctx) => {
        // Звільнити зарезервовані товари
        console.log(`Releasing stock for ${ctx.items.length} items`);
      },
    })
    .addStep({
      name: "process_payment",
      execute: async (ctx) => {
        // Обробити оплату
        console.log(`Processing payment for order ${ctx.orderId}`);
      },
      compensate: async (ctx) => {
        // Повернути кошти
        console.log(`Refunding payment for order ${ctx.orderId}`);
      },
    })
    .addStep({
      name: "send_confirmation",
      execute: async (ctx) => {
        // Надіслати підтвердження
        console.log(`Sending confirmation for order ${ctx.orderId}`);
      },
      compensate: async () => {
        // Немає чого компенсувати
      },
    });
}
