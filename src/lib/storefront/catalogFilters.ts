/**
 * Catalog filter helpers — pure logic shared by the storefront index,
 * collection and search routes.
 *
 * Filter state lives in URL search params (shareable links) and is validated
 * with zod via TanStack Router's `validateSearch`, mirroring the existing
 * `?q=` pattern on the search page. Price bounds are expressed in whole
 * hryvnias in the URL (`?price_min=100` = 100 ₴) while products store
 * `price_cents`, so bounds are converted before comparison.
 */
import { z } from "zod";

/**
 * URL search-param schema for catalog filters. Every field tolerates garbage
 * input (`.catch(undefined)`) so a hand-edited URL never crashes the route.
 * Routes that cannot filter by collection (collection page, search page)
 * use `catalogFiltersSchema.omit({ collection: true })`.
 */
export const catalogFiltersSchema = z.object({
  /** Minimum price, whole hryvnias. */
  price_min: z.number().nonnegative().optional().catch(undefined),
  /** Maximum price, whole hryvnias. */
  price_max: z.number().nonnegative().optional().catch(undefined),
  /** Only products with stock > 0. */
  in_stock: z.boolean().optional().catch(undefined),
  /** Collection handle (index page only). */
  collection: z.string().optional().catch(undefined),
});

export type CatalogFilters = z.infer<typeof catalogFiltersSchema>;

/** Minimal product shape the filters need. */
export type FilterableProduct = {
  id: string;
  price_cents: number;
  stock: number;
};

/**
 * Applies price / stock / collection filters to a product list.
 *
 * @param collectionProductIds — set of product ids belonging to the selected
 * collection (index page resolves it via `loadCollectionProducts`). Pass
 * `undefined` while the membership data is loading or when no collection
 * filter is active — the collection criterion is then skipped.
 *
 * Bounds are inclusive. If `price_min > price_max` the range is honoured
 * literally and yields an empty result (the UI shows a "reset" affordance).
 */
export function applyCatalogFilters<T extends FilterableProduct>(
  products: T[],
  filters: Pick<CatalogFilters, "price_min" | "price_max" | "in_stock">,
  collectionProductIds?: ReadonlySet<string>,
): T[] {
  const minCents = filters.price_min != null ? filters.price_min * 100 : null;
  const maxCents = filters.price_max != null ? filters.price_max * 100 : null;

  return products.filter((p) => {
    if (minCents != null && p.price_cents < minCents) return false;
    if (maxCents != null && p.price_cents > maxCents) return false;
    if (filters.in_stock && p.stock <= 0) return false;
    if (collectionProductIds && !collectionProductIds.has(p.id)) return false;
    return true;
  });
}

/**
 * Number of active filter groups for the badge counter:
 * price range (min and/or max) = 1, in-stock = 1, collection = 1.
 */
export function countActiveFilters(filters: CatalogFilters): number {
  let count = 0;
  if (filters.price_min != null || filters.price_max != null) count += 1;
  if (filters.in_stock) count += 1;
  if (filters.collection) count += 1;
  return count;
}

/** Filter state with everything cleared (used by the reset button). */
export const EMPTY_CATALOG_FILTERS: CatalogFilters = {
  price_min: undefined,
  price_max: undefined,
  in_stock: undefined,
  collection: undefined,
};
