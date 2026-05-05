import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors/AppError.js";

const internalServerErrorMessage = "Internal server error";

const errorStatusCode = (error: unknown) => {
  if (!(error instanceof Error)) {
    return null;
  }

  const statusCode = (error as { statusCode?: unknown; status?: unknown })
    .statusCode;
  const status = (error as { status?: unknown }).status;
  const candidate = typeof statusCode === "number" ? statusCode : status;

  return typeof candidate === "number" && candidate >= 400 && candidate < 600
    ? candidate
    : null;
};

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
          error.statusCode >= 500 ? internalServerErrorMessage : error.message,
      },
    });
    return;
  }

  const statusCode = errorStatusCode(error);

  if (statusCode && statusCode < 500) {
    response.status(statusCode).json({
      error: {
        message: "Bad request",
      },
    });
    return;
  }

  response.status(500).json({
    error: {
      message: internalServerErrorMessage,
    },
  });
};
