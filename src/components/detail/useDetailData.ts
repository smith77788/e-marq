/**
 * Shared query key + hook for loading detail payloads.
 * Uses TanStack Query so prefetch (on hover) → instant open works.
 */
import { useQuery } from "@tanstack/react-query";
import type { DetailHandle, DetailPayload } from "./types";

export function detailQueryKey(resourceType: string, elementId: string) {
  return ["detail", resourceType, elementId] as const;
}

export function useDetailData(handle: DetailHandle | null, staleTime = 30_000) {
  const enabled = !!handle && (!!handle.fetchDetail || !!handle.payload);

  const query = useQuery<DetailPayload>({
    queryKey: handle
      ? detailQueryKey(handle.resourceType, handle.elementId)
      : ["detail", "noop"],
    enabled,
    staleTime,
    queryFn: async () => {
      if (!handle) throw new Error("No detail handle");
      if (handle.payload) return handle.payload;
      if (handle.fetchDetail) return handle.fetchDetail();
      throw new Error("No fetcher or eager payload supplied");
    },
  });

  return query;
}
