import { Request, Response } from 'express';
import { z } from 'zod';
import { normalizeTicker, seekingAlphaQuantService } from '../services/seeking-alpha-quant.service';
import { asyncHandler } from '../utils/async-handler';
import { buildResponse } from '../utils/response';

const lookupRequestSchema = z.object({ ticker: z.unknown() }).strict();

export const postSeekingAlphaQuantRatingLookup = asyncHandler(
  async (req: Request, res: Response) => {
    const request = lookupRequestSchema.safeParse(req.body);
    const ticker = request.success ? normalizeTicker(request.data.ticker) : null;
    if (!ticker) {
      return buildResponse.error(
        res,
        'Ticker must be a supported 1-15 character symbol',
        400,
        'INVALID_TICKER'
      );
    }

    const rating = await seekingAlphaQuantService.lookup(ticker);
    return buildResponse.success(res, rating);
  }
);
