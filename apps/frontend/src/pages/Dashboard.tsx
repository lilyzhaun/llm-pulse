import { useEffect, useMemo, useState } from "react";
import type {
  AvailabilityResponse,
  ModelAvailability,
} from "@llm-pulse/shared";
import { ModelPulseCard } from "../components/ModelPulseCard";
import { Toolbar } from "../components/Toolbar";
import { getAvailabilitySnapshot } from "../lib/api";

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
  const [reloadToken, setReloadToken] = useState(0);

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
            : "无法加载状态快照。",
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

  const sortedModels = useMemo(
    () => sortModels(snapshot?.models ?? []),
    [snapshot],
  );

  if (isLoading && !snapshot) {
    return (
      <main className="shell">
        <section className="loading-panel">
          <p className="loading-panel__eyebrow">状态加载中</p>
          <h1>正在加载模型状态…</h1>
          <p>请稍候。</p>
        </section>
      </main>
    );
  }

  if (error && !snapshot) {
    return (
      <main className="shell">
        <section className="error-panel">
          <p className="loading-panel__eyebrow">状态加载失败</p>
          <h1>暂时无法获取模型状态</h1>
          <p>请稍后重试。</p>
          <p className="error-panel__detail">{error}</p>
          <button
            className="action-button"
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            重新加载
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
      <Toolbar snapshot={snapshot} />

      <section className="dashboard-layout">
        <div className="dashboard-layout__main dashboard-layout__main--full">
          <div className="section-heading">
            <div>
              <h2>活跃模型</h2>
            </div>
            <p className="section-heading__hint">按最近请求时间排序</p>
          </div>

          <div className="model-grid">
            {sortedModels.map((model) => (
              <ModelPulseCard key={model.modelName} model={model} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
