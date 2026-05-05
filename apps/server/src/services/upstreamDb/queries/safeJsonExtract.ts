const JSON_NUMBER_PATTERN = "-?\\d+(?:\\.\\d+)?";

export const CACHE_TOKENS_SQL = `
  CASE
    WHEN logs.other IS NULL OR btrim(logs.other) = '' THEN 0
    ELSE COALESCE(
      NULLIF(
        substring(
          logs.other
          from '"cache_tokens"\\s*:\\s*"?(${JSON_NUMBER_PATTERN})"?'
        ),
        ''
      )::numeric,
      0
    )
  END
`;
