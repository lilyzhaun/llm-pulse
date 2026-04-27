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

function isAvailabilityResponse(
  payload: unknown,
): payload is AvailabilityResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<AvailabilityResponse>;

  return (
    typeof candidate.generatedAt === "string" &&
    Boolean(candidate.window) &&
    Boolean(candidate.heartbeat) &&
    Boolean(candidate.summary) &&
    Array.isArray(candidate.models)
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
    throw new Error(`Pulse API responded with ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!isAvailabilityResponse(payload)) {
    throw new Error("Pulse API returned an unexpected payload.");
  }

  return payload;
}
