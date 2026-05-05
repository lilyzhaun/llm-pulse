export interface SqlQuery {
  text: string;
  values: readonly unknown[];
}

export const selectEnabledModelsQuery = (): SqlQuery => ({
  text: `
		SELECT model
		FROM abilities
		WHERE enabled = true
		ORDER BY model ASC
	`,
  values: [],
});

export const selectBootstrapUpperWatermarkQuery = (
  upperCreatedAt: number,
): SqlQuery => ({
  text: `
		SELECT
			COALESCE(MAX(id), 0) AS max_id,
			COALESCE(MAX(created_at), 0) AS max_created_at
		FROM logs
		WHERE created_at <= $1::bigint
			AND type IN (2, 5)
	`,
  values: [upperCreatedAt],
});

export const selectLogsForBootstrapQuery = (params: {
  modelNames: readonly string[];
  upperCreatedAt: number;
  upperId: number;
  cursorCreatedAt: number | null;
  cursorId: number | null;
  batchSize: number;
}): SqlQuery => {
  const {
    modelNames,
    upperCreatedAt,
    upperId,
    cursorCreatedAt,
    cursorId,
    batchSize,
  } = params;

  const values: unknown[] = [modelNames, upperCreatedAt, upperId];
  let cursorClause = "";
  if (cursorCreatedAt !== null && cursorId !== null) {
    values.push(cursorCreatedAt, cursorId);
    cursorClause = `
			AND (
				logs.created_at < $4::bigint
				OR (logs.created_at = $4::bigint AND logs.id < $5::bigint)
			)
		`;
  }
  values.push(batchSize);
  const batchSizeIndex = values.length;

  return {
    text: `
			SELECT
				logs.id,
				logs.created_at,
				logs.type,
				logs.model_name,
				COALESCE(logs.channel_id, 0) AS channel_id,
				COALESCE(NULLIF(logs.channel_name, ''), 'unknown') AS channel_name,
				COALESCE(logs.prompt_tokens, 0) AS prompt_tokens,
				COALESCE(logs.completion_tokens, 0) AS completion_tokens,
				COALESCE(logs.quota, 0) AS quota,
				COALESCE(logs.use_time, 0) AS use_time,
				logs.other
			FROM logs
			WHERE logs.type IN (2, 5)
				AND logs.model_name = ANY($1::text[])
				AND logs.model_name IS NOT NULL
				AND logs.model_name <> ''
				AND (
					logs.created_at < $2::bigint
					OR (logs.created_at = $2::bigint AND logs.id <= $3::bigint)
				)
				${cursorClause}
			ORDER BY logs.created_at DESC, logs.id DESC
			LIMIT $${batchSizeIndex}
		`,
    values,
  };
};

export const selectLogsInWindowQuery = (params: {
  modelNames: readonly string[];
  lowerCreatedAt: number;
  upperCreatedAt: number;
  cursorCreatedAt: number | null;
  cursorId: number | null;
  batchSize: number;
}): SqlQuery => {
  const {
    modelNames,
    lowerCreatedAt,
    upperCreatedAt,
    cursorCreatedAt,
    cursorId,
    batchSize,
  } = params;

  const values: unknown[] = [modelNames, lowerCreatedAt, upperCreatedAt];
  let cursorClause = "";
  if (cursorCreatedAt !== null && cursorId !== null) {
    values.push(cursorCreatedAt, cursorId);
    cursorClause = `
			AND (
				logs.created_at > $4::bigint
				OR (logs.created_at = $4::bigint AND logs.id > $5::bigint)
			)
		`;
  }
  values.push(batchSize);
  const batchSizeIndex = values.length;

  return {
    text: `
			SELECT
				logs.id,
				logs.created_at,
				logs.type,
				logs.model_name,
				COALESCE(logs.channel_id, 0) AS channel_id,
				COALESCE(NULLIF(logs.channel_name, ''), 'unknown') AS channel_name,
				COALESCE(logs.prompt_tokens, 0) AS prompt_tokens,
				COALESCE(logs.completion_tokens, 0) AS completion_tokens,
				COALESCE(logs.quota, 0) AS quota,
				COALESCE(logs.use_time, 0) AS use_time,
				logs.other
			FROM logs
			WHERE logs.type IN (2, 5)
				AND logs.model_name = ANY($1::text[])
				AND logs.model_name IS NOT NULL
				AND logs.model_name <> ''
				AND logs.created_at >= $2::bigint
				AND logs.created_at < $3::bigint
				${cursorClause}
			ORDER BY logs.created_at ASC, logs.id ASC
			LIMIT $${batchSizeIndex}
		`,
    values,
  };
};
