/**
 * Detail controller: a single global drawer instance + URL ?detail= sync.
 *
 * Why a controller (not local state per wrapper)?
 *  - Only ONE drawer can be open at a time, so DOM stays light.
 *  - URL becomes the source of truth → shareable & restorable on reload.
 *  - Wrappers register their fetcher into a registry keyed by `${type}:${id}`.
 *
 * Use:
 *   const ctrl = useDetailController();
 *   ctrl.open({ resourceType: "kpi", elementId: "revenue", fetchDetail: ... });
 */
import * as React from "react";
import type { DetailHandle } from "./types";

type RegistryEntry = Pick<DetailHandle, "fetchDetail" | "payload" | "drawerTitle" | "drawerSize">;

type ControllerState = {
  active: DetailHandle | null;
};

type ControllerContextValue = {
  state: ControllerState;
  open: (handle: DetailHandle) => void;
  close: () => void;
  /**
   * Wrappers call this on mount so that if the URL already references their
   * id, the drawer can rehydrate without a click.
   */
  register: (resourceType: string, elementId: string, entry: RegistryEntry) => () => void;
};

const Ctx = React.createContext<ControllerContextValue | null>(null);

const URL_PARAM = "detail";

function readUrlKey(): { resourceType: string; elementId: string } | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get(URL_PARAM);
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx === raw.length - 1) return null;
  return { resourceType: raw.slice(0, idx), elementId: raw.slice(idx + 1) };
}

function writeUrlKey(handle: DetailHandle | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (handle) {
    url.searchParams.set(URL_PARAM, `${handle.resourceType}:${handle.elementId}`);
  } else {
    url.searchParams.delete(URL_PARAM);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

export function DetailControllerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ControllerState>({ active: null });
  const registryRef = React.useRef<Map<string, RegistryEntry>>(new Map());

  const open = React.useCallback((handle: DetailHandle) => {
    setState({ active: handle });
    writeUrlKey(handle);
  }, []);

  const close = React.useCallback(() => {
    setState({ active: null });
    writeUrlKey(null);
  }, []);

  const register = React.useCallback<ControllerContextValue["register"]>(
    (resourceType, elementId, entry) => {
      const key = `${resourceType}:${elementId}`;
      registryRef.current.set(key, entry);

      // Rehydrate from URL if this is the targeted element.
      const fromUrl = readUrlKey();
      if (fromUrl && fromUrl.resourceType === resourceType && fromUrl.elementId === elementId) {
        // Defer to next tick so multiple wrappers mounting in same frame don't fight.
        queueMicrotask(() => {
          setState((prev) => {
            if (prev.active) return prev; // already open
            return {
              active: {
                resourceType: resourceType as DetailHandle["resourceType"],
                elementId,
                drawerTitle: entry.drawerTitle,
                drawerSize: entry.drawerSize,
                fetchDetail: entry.fetchDetail,
                payload: entry.payload,
              },
            };
          });
        });
      }

      return () => {
        registryRef.current.delete(key);
      };
    },
    [],
  );

  // Browser back/forward should also reflect drawer state.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const fromUrl = readUrlKey();
      if (!fromUrl) {
        setState({ active: null });
        return;
      }
      const entry = registryRef.current.get(`${fromUrl.resourceType}:${fromUrl.elementId}`);
      if (entry) {
        setState({
          active: {
            resourceType: fromUrl.resourceType as DetailHandle["resourceType"],
            elementId: fromUrl.elementId,
            drawerTitle: entry.drawerTitle,
            drawerSize: entry.drawerSize,
            fetchDetail: entry.fetchDetail,
            payload: entry.payload,
          },
        });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const value = React.useMemo<ControllerContextValue>(
    () => ({ state, open, close, register }),
    [state, open, close, register],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDetailController(): ControllerContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("useDetailController must be used inside <DetailControllerProvider>");
  }
  return ctx;
}

/** Optional hook — returns null if no provider is mounted. Used by wrappers
 *  so they degrade gracefully on pages without the provider. */
export function useOptionalDetailController(): ControllerContextValue | null {
  return React.useContext(Ctx);
}
