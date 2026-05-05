import { META_KEYS } from "../schema.js";
import type { SnapshotData } from "../types.js";
import type { BucketStore } from "./bucketStore.js";
import type { EnabledModelStore } from "./enabledModelStore.js";
import type { MetaStore } from "./metaStore.js";
import type { ProcessedLogStore } from "./processedLogStore.js";

export const readSnapshotFromStores = (deps: {
  metaStore: MetaStore;
  enabledModelStore: EnabledModelStore;
  bucketStore: BucketStore;
  processedLogStore: ProcessedLogStore;
}): SnapshotData => {
  const coveredCreatedAt = deps.metaStore.getMeta(
    META_KEYS.COVERED_UNTIL_CREATED_AT,
  );
  const coveredId = deps.metaStore.getMeta(META_KEYS.COVERED_UNTIL_ID);

  return {
    bootstrapCompletedAt: deps.metaStore.getMeta(
      META_KEYS.BOOTSTRAP_COMPLETED_AT,
    ),
    coveredUntilCreatedAt: coveredCreatedAt ? Number(coveredCreatedAt) : null,
    coveredUntilId: coveredId ? Number(coveredId) : null,
    lastRefreshAt: deps.metaStore.getMeta(META_KEYS.LAST_REFRESH_AT),
    lastSuccessAt: deps.metaStore.getMeta(META_KEYS.LAST_SUCCESS_AT),
    enabledModels: new Set(deps.enabledModelStore.getEnabledModels()),
    models: deps.bucketStore.readModelRows(),
    channels: deps.bucketStore.readChannelRows(),
    processedLogCount: deps.processedLogStore.processedLogCount(),
  };
};
