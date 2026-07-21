import { Request, Response } from 'express';
import { buildResponse } from '../utils/response';

export const notFoundMiddleware = (req: Request, res: Response): Response => {
  return buildResponse.error(res, `Route ${req.path} not found`, 404);
};
