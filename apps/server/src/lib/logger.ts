import pino from "pino";

import { env, isProduction } from "../config/env.js";

export const logger = pino({
  level: env.logLevel ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "authorization",
      "Authorization",
      "cookie",
      "Cookie",
      "set-cookie",
      "password",
      "token",
      "apiKey",
      "api_key",
      "secret",
      "*.authorization",
      "*.Authorization",
      "*.cookie",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.secret",
      "error.config.headers.authorization",
      "error.config.headers.Authorization",
      "error.config.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});
