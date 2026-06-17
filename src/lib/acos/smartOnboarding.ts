/**
 * Smart Onboarding — персоналізований онбординг для нових власників бізнесу.
 *
 * Кроки:
 * 1. Вибір ніші (яку продукцію продаєте)
 * 2. Підключення джерела даних (Shopify/CSV)
 * 3. Налаштування бренду (кольори, лого)
 * 4. Підключення Telegram
 * 5. Запуск першого агента
 * 6. Перший insight
 *
 * Адаптується під нішу та розмір бізнесу.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  estimated_minutes: number;
  required: boolean;
  completed: boolean;
};

export type OnboardingProgress = {
  tenant_id: string;
  current_step: number;
  total_steps: number;
  completed_steps: number;
  estimated_completion: string;
  steps: OnboardingStep[];
};

/**
 * Отримати прогрес онбордингу.
 */
export async function getOnboardingProgress(
  tenantId: string,
): Promise<OnboardingProgress> {
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const features = (config?.features ?? {}) as Record<string, unknown>;
  const onboarding = (features.onboarding ?? {}) as Record<string, unknown>;

  const steps: OnboardingStep[] = [
    {
      id: "niche",
      title: "Оберіть нішу",
      description: "Яку продукцію ви продаєте?",
      estimated_minutes: 1,
      required: true,
      completed: !!onboarding.niche_selected,
    },
    {
      id: "data_source",
      title: "Підключіть дані",
      description: "Shopify, WooCommerce або CSV",
      estimated_minutes: 5,
      required: true,
      completed: !!onboarding.data_connected,
    },
    {
      id: "brand",
      title: "Налаштуйте бренд",
      description: "Кольори, лого, опис",
      estimated_minutes: 3,
      required: false,
      completed: !!onboarding.brand_configured,
    },
    {
      id: "telegram",
      title: "Підключіть Telegram",
      description: "Отримуйте сповіщення в Telegram",
      estimated_minutes: 2,
      required: false,
      completed: !!onboarding.telegram_connected,
    },
    {
      id: "first_agent",
      title: "Запустіть першого агента",
      description: "Спробуйте AI-помічника",
      estimated_minutes: 1,
      required: false,
      completed: !!onboarding.first_agent_run,
    },
    {
      id: "first_insight",
      title: "Отримайте перший insight",
      description: "Система знайде першу можливість",
      estimated_minutes: 5,
      required: false,
      completed: !!onboarding.first_insight,
    },
  ];

  const completed = steps.filter((s) => s.completed).length;
  const currentStep = steps.findIndex((s) => !s.completed);

  return {
    tenant_id: tenantId,
    current_step: currentStep >= 0 ? currentStep : steps.length,
    total_steps: steps.length,
    completed_steps: completed,
    estimated_completion: new Date(Date.now() + (steps.length - completed) * 3 * 60000).toISOString(),
    steps,
  };
}

/**
 * Позначити крок онбордингу як виконаний.
 */
export async function completeOnboardingStep(
  tenantId: string,
  stepId: string,
): Promise<{ ok: boolean }> {
  const { data: config } = await supabaseAdmin
    .from("tenant_configs")
    .select("features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const features = (config?.features ?? {}) as Record<string, unknown>;
  const onboarding = (features.onboarding ?? {}) as Record<string, unknown>;

  const { error } = await supabaseAdmin
    .from("tenant_configs")
    .update({
      features: {
        ...features,
        onboarding: {
          ...onboarding,
          [`${stepId}_selected`]: true,
          [`${stepId}_connected`]: true,
          [`${stepId}_configured`]: true,
          [`${stepId}_connected`]: true,
          [`${stepId}_run`]: true,
          [`${stepId}_completed`]: true,
        },
      },
    })
    .eq("tenant_id", tenantId);

  return { ok: !error };
}
