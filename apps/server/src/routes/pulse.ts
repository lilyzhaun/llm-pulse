import { Router } from "express";
import { aggregationService } from "../services/aggregationService.js";

export const pulseRouter = Router();

pulseRouter.get("/", async (_request, response, next) => {
  try {
    const pulse = await aggregationService.getAggregatedPulse();

    response.json(pulse);
  } catch (error) {
    next(error);
  }
});
