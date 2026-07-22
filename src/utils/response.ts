import { Response } from 'express';
import { ApiResponse } from '../types/api.types';

export class ResponseBuilder {
  static success<T>(
    res: Response,
    data: T,
    statusCode: number = 200,
    meta?: Partial<ApiResponse['meta']>
  ): Response {
    const response: ApiResponse<T> = {
      success: true,
      data,
      meta: {
        durationMs: Date.now() - (res.locals.startTime || Date.now()),
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };

    return res.status(statusCode).json(response);
  }

  static error(
    res: Response,
    error: string,
    statusCode: number = 500,
    code?: string,
    meta?: Partial<ApiResponse['meta']>
  ): Response {
    const response: ApiResponse = {
      success: false,
      error,
      ...(code ? { code } : {}),
      meta: {
        durationMs: Date.now() - (res.locals.startTime || Date.now()),
        timestamp: new Date().toISOString(),
        ...meta,
      },
    };

    return res.status(statusCode).json(response);
  }
}

export const buildResponse = ResponseBuilder;
