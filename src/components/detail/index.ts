/**
 * Public surface for the universal detail system.
 * Import from "@/components/detail" everywhere else.
 */
export { DetailControllerProvider, useDetailController, useOptionalDetailController } from "./DetailController";
export { DetailableElement } from "./DetailableElement";
export { DetailDrawer } from "./DetailDrawer";
export { useDetailData, detailQueryKey } from "./useDetailData";
export type {
  DetailHandle,
  DetailPayload,
  DetailAction,
  MetricBlock,
  TimeseriesPoint,
  EventLogItem,
  RelatedItem,
  MediaItem,
  AiInsightBlock,
  ResourceType,
  DrawerSize,
} from "./types";
