/**
 * React hook around the localStorage wishlist. Re-renders on toggles
 * (same tab via subscribeWishlist) and cross-tab (storage event).
 */
import { useCallback, useEffect, useState } from "react";
import {
  loadWishlist,
  saveWishlist,
  subscribeWishlist,
  toggleWishlist as toggleStore,
} from "@/lib/storefront/wishlist";

export function useWishlist(tenantId: string) {
  const [ids, setIds] = useState<string[]>(() => loadWishlist(tenantId));

  useEffect(() => {
    setIds(loadWishlist(tenantId));
    return subscribeWishlist(() => setIds(loadWishlist(tenantId)));
  }, [tenantId]);

  const toggle = useCallback(
    (productId: string) => {
      const inList = toggleStore(tenantId, productId);
      setIds(loadWishlist(tenantId));
      return inList;
    },
    [tenantId],
  );

  const clear = useCallback(() => {
    saveWishlist(tenantId, []);
    setIds([]);
  }, [tenantId]);

  return { ids, count: ids.length, has: (id: string) => ids.includes(id), toggle, clear };
}
