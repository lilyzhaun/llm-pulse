import type { UpstreamQueryClient } from "./modelAggregates.js";

export const SYSTEM_NAME_SQL = `
  SELECT value FROM options WHERE key = 'SystemName' LIMIT 1
`;

export const getSystemName = async (
  client: UpstreamQueryClient,
): Promise<string | null> => {
  const result = await client.query<{ value: string }>(SYSTEM_NAME_SQL, []);

  if (result.rows.length === 0) {
    return null;
  }

  const value = result.rows[0]?.value;

  return value?.trim() || null;
};
