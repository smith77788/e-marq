/**
 * Клієнтський helper для Nova Poshta — звертається до /api/public/shipping/np.
 */
export type NPCity = {
  ref: string;
  name: string;
  area: string;
  region: string;
  present: string;
};

export type NPWarehouse = {
  ref: string;
  number: string;
  description: string;
  shortAddress: string;
  typeOfWarehouse: string;
  categoryOfWarehouse: string;
};

export type NPSelection = {
  cityRef: string;
  cityName: string;
  warehouseRef: string;
  warehouseNumber: string;
  warehouseDescription: string;
};

async function call<T>(body: unknown): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("/api/public/shipping/np", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 503) throw new Error("Доставка тимчасово недоступна");
      if (res.status === 429) throw new Error("Забагато запитів, спробуйте пізніше");
      throw new Error(`Помилка ${res.status}`);
    }
    const json = (await res.json()) as { data?: T[]; error?: string };
    if (json.error) throw new Error(json.error);
    return json.data ?? [];
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError")
      throw new Error("Час очікування вичерпано, спробуйте ще раз");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function searchCities(query: string): Promise<NPCity[]> {
  return call<NPCity>({ kind: "cities", query });
}

export function searchWarehouses(cityRef: string, query?: string): Promise<NPWarehouse[]> {
  return call<NPWarehouse>({ kind: "warehouses", cityRef, query });
}
