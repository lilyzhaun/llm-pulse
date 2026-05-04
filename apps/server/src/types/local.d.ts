declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string;
    PORT?: string;
    BFF_PORT?: string;
    LOG_LEVEL?: string;
    DATABASE_URL?: string;
    POLL_INTERVAL_MS?: string;
    PULSE_REFRESH_INTERVAL_MS?: string;
    AVAILABILITY_WINDOW_SECONDS?: string;
    PULSE_QUERY_TIMEOUT_MS?: string;
    PULSE_DB_POOL_MAX?: string;
    PULSE_DB_IDLE_TIMEOUT_MS?: string;
    PULSE_DB_CONN_TIMEOUT_MS?: string;
  }
}
