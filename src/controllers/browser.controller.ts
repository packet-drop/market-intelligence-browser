import { Request, Response } from 'express';
import { browserService } from '../services/browser.service';
import { asyncHandler } from '../utils/async-handler';
import { buildResponse } from '../utils/response';

export const postBrowserSmoke = asyncHandler(async (_req: Request, res: Response) => {
  const result = await browserService.runSmokeCheck();
  return buildResponse.success(res, result);
});
