import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { HttpError } from '../utils/http-error';
import { buildResponse } from '../utils/response';
import env from '../config/env';

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  logger.error('Error:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  if (error instanceof HttpError) {
    return buildResponse.error(res, error.message, error.statusCode);
  }

  const statusCode = 500;
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : error.message;

  return buildResponse.error(res, message, statusCode);
};
