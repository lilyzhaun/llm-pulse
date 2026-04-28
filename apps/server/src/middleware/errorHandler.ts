import type { ErrorRequestHandler, RequestHandler } from "express";
import { isProduction } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

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
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        message:
          isProduction && error.statusCode >= 500
            ? "Internal server error"
            : error.message,
      },
    });
    return;
  }

  const message =
    error instanceof Error ? error.message : "Unexpected server error";

  response.status(500).json({
    error: {
      message: isProduction ? "Internal server error" : message,
    },
  });
};
