import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import env from '../config/env';
import { buildResponse } from '../utils/response';

export const createRateLimiter = (): RateLimitRequestHandler => {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    handler: (_req, res) =>
      buildResponse.error(res, 'Too many requests, please try again later', 429),
    standardHeaders: true,
    legacyHeaders: false,
  });
};

export const rateLimitMiddleware = createRateLimiter();
