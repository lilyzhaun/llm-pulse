import type {
  AvailabilityResponse,
  ModelAvailability,
} from "@llm-pulse/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelPulseCard } from "../components/ModelPulseCard";
import { Toolbar } from "../components/Toolbar";
import { getAvailabilitySnapshot } from "../lib/api";

const REFRESH_THROTTLE_MS = 1000;

function sortModels(models: ModelAvailability[]) {
  return [...models].sort((left, right) => {
    const rightLastSeenAt = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;
    const leftLastSeenAt = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;

    if (rightLastSeenAt !== leftLastSeenAt) {
      return rightLastSeenAt - leftLastSeenAt;
    }

    return right.totalCount - left.totalCount;
  });
}

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const lastRefreshAtRef = useRef<number>(0);
  const throttleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setIsLoading(true);
    setError(null);

    void getAvailabilitySnapshot(controller.signal)
      .then((response) => {
        setSnapshot(response);
      })
      .catch((caughtError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setSnapshot(null);
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "无法加载 Snapshot。",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [reloadToken]);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  const handleRefreshSnapshot = useCallback(() => {
    if (isRefreshing || !canRefresh) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastRefreshAtRef.current;
    if (elapsed < REFRESH_THROTTLE_MS) {
      return;
    }

    lastRefreshAtRef.current = now;
    setIsRefreshing(true);
    setCanRefresh(false);

    if (throttleTimerRef.current !== null) {
      window.clearTimeout(throttleTimerRef.current);
    }
    throttleTimerRef.current = window.setTimeout(() => {
      setCanRefresh(true);
      throttleTimerRef.current = null;
    }, REFRESH_THROTTLE_MS);

    void getAvailabilitySnapshot()
      .then((response) => {
        setSnapshot(response);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "无法加载 Snapshot。",
        );
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  }, [canRefresh, isRefreshing]);

  const normalizedModelSearchQuery = modelSearchQuery.trim().toLowerCase();

  const sortedModels = useMemo(() => {
    const models = sortModels(snapshot?.models ?? []);

    if (!normalizedModelSearchQuery) {
      return models;
    }

    return models.filter((model) =>
      model.modelName.toLowerCase().includes(normalizedModelSearchQuery),
    );
  }, [normalizedModelSearchQuery, snapshot]);

  if (isLoading && !snapshot) {
    return (
      <main className="shell">
        <section className="loading-panel">
          <p className="loading-panel__eyebrow">加载 Snapshot</p>
          <h1>正在读取 Model 状态…</h1>
          <p>请稍等。</p>
        </section>
      </main>
    );
  }

  if (error && !snapshot) {
    return (
      <main className="shell">
        <section className="error-panel">
          <p className="loading-panel__eyebrow">Snapshot 加载失败</p>
          <h1>无法读取 Model 状态</h1>
          <p>请重试。</p>
          <p className="error-panel__detail">{error}</p>
          <button
            className="action-button"
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            重试
          </button>
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <main className="shell">
      <Toolbar
        snapshot={snapshot}
        modelSearchQuery={modelSearchQuery}
        onModelSearchQueryChange={setModelSearchQuery}
        isRefreshing={isRefreshing}
        canRefresh={canRefresh}
        onRefresh={handleRefreshSnapshot}
      />

      <section className="dashboard-layout">
        <div className="dashboard-layout__main dashboard-layout__main--full">
          <div className="section-heading">
            <div>
              <h2>活跃 Model</h2>
            </div>
            <p className="section-heading__hint">
              {normalizedModelSearchQuery
                ? `已筛选 ${sortedModels.length} 个匹配 Model`
                : "按最近 Request 排序"}
            </p>
          </div>

          {sortedModels.length > 0 ? (
            <div className="model-grid">
              {sortedModels.map((model) => (
                <ModelPulseCard key={model.modelName} model={model} />
              ))}
            </div>
          ) : (
            <section className="empty-state-panel">
              <p className="loading-panel__eyebrow">没有匹配结果</p>
              <h3>未找到符合关键词的 Model</h3>
              <p>请尝试其他关键词。</p>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
