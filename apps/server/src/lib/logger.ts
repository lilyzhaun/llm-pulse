import pino from "pino";

import { env, isProduction } from "../config/env.js";

export const logger = pino({
  level: env.logLevel ?? (isProduction ? "info" : "debug"),
});
