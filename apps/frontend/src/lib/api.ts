import type { AvailabilityResponse } from "@llm-pulse/shared";

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return ensureTrailingSlash(configuredBaseUrl);
  }

  if (typeof window !== "undefined") {
    return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
  }

  return import.meta.env.BASE_URL;
}

function createApiUrl(pathname: string) {
  return new URL(
    pathname.replace(/^\//, ""),
    ensureTrailingSlash(resolveApiBaseUrl()),
  ).toString();
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isDataSource(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.kind === "upstream-postgres" ||
      candidate.kind === "memory-snapshot" ||
      candidate.kind === "empty") &&
    isNullableString(candidate.lastQueryAt) &&
    isNullableNumber(candidate.lastQueryDurationMs) &&
    isNullableString(candidate.lastErrorMessage)
  );
}

function isTokenUsage(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    isNumber(candidate.input) &&
    isNumber(candidate.cacheInput) &&
    isNumber(candidate.output) &&
    isNumber(candidate.total)
  );
}

function isCostUsage(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return isNumber(candidate.quota);
}

function isRateUsage(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return isNumber(candidate.average) && isNumber(candidate.peak);
}

function hasValidModelUsageFields(model: unknown) {
  if (!model || typeof model !== "object") {
    return false;
  }

  const candidate = model as Record<string, unknown>;

  return (
    isTokenUsage(candidate.tokens) &&
    isCostUsage(candidate.cost) &&
    isRateUsage(candidate.rpm) &&
    isRateUsage(candidate.tpm)
  );
}

function isAvailabilityResponse(
  payload: unknown,
): payload is AvailabilityResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<AvailabilityResponse>;

  return (
    typeof candidate.generatedAt === "string" &&
    isDataSource(candidate.dataSource) &&
    Boolean(candidate.window) &&
    Boolean(candidate.heartbeat) &&
    Boolean(candidate.summary) &&
    Array.isArray(candidate.models) &&
    candidate.models.every(hasValidModelUsageFields)
  );
}

export async function getAvailabilitySnapshot(
  signal?: AbortSignal,
): Promise<AvailabilityResponse> {
  const response = await fetch(createApiUrl("api/pulse"), {
    headers: {
      Accept: "application/json",
    },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Pulse API 返回 ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!isAvailabilityResponse(payload)) {
    throw new Error("Pulse API 返回格式不正确。");
  }

  return payload;
}
