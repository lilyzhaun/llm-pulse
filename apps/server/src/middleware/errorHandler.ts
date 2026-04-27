import type { ErrorRequestHandler, RequestHandler } from "express";
import { isProduction } from "../config/env.js";

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      message: `Route ${request.method} ${request.path} not found`,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  const message =
    error instanceof Error ? error.message : "Unexpected server error";

  response.status(500).json({
    error: {
      message: isProduction ? "Internal server error" : message,
    },
  });
};
