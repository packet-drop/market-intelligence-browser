import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import env from '../config/env';
import { buildResponse } from '../utils/response';

const secureTokenMatch = (provided: string, expected: string): boolean => {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

export const sessionAdminAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): Response | void => {
  if (!env.SEEKING_ALPHA_SESSION_IMPORT_ENABLED) {
    return buildResponse.error(res, 'Not found', 404);
  }

  const authorization = req.get('authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (
    !match ||
    !env.SEEKING_ALPHA_SESSION_ADMIN_KEY ||
    !secureTokenMatch(match[1], env.SEEKING_ALPHA_SESSION_ADMIN_KEY)
  ) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return buildResponse.error(res, 'Unauthorized', 401);
  }

  next();
};
