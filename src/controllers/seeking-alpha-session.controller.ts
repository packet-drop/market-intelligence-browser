import { Request, Response } from 'express';
import { seekingAlphaSessionService } from '../services/seeking-alpha-session.service';
import { storageStateSchema } from '../services/seeking-alpha-session-store';
import { asyncHandler } from '../utils/async-handler';
import { buildResponse } from '../utils/response';

export const postSeekingAlphaSessionImport = asyncHandler(async (req: Request, res: Response) => {
  const parsed = storageStateSchema.safeParse(req.body);
  if (!parsed.success) {
    return buildResponse.error(res, 'Invalid Playwright storage state', 400);
  }

  const imported = await seekingAlphaSessionService.importSession(parsed.data);
  return buildResponse.success(res, imported, 201);
});

export const postSeekingAlphaSessionCheck = asyncHandler(async (_req: Request, res: Response) => {
  const checked = await seekingAlphaSessionService.checkSession();
  const statusCode = checked.state === 'UNAVAILABLE' ? 503 : 200;
  return buildResponse.success(res, checked, statusCode);
});
