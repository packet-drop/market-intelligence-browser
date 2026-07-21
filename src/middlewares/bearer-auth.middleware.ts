import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import env from '../config/env';
import { buildResponse } from '../utils/response';

const secureTokenMatch = (provided: string, expected: string): boolean => {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();

  return timingSafeEqual(providedDigest, expectedDigest);
};

export const bearerAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): Response | void => {
  if (!env.SERVICE_API_KEY) {
    return buildResponse.error(res, 'Service authentication is not configured', 503);
  }

  const authorization = req.get('authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (!match || !secureTokenMatch(match[1], env.SERVICE_API_KEY)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return buildResponse.error(res, 'Unauthorized', 401);
  }

  next();
};
