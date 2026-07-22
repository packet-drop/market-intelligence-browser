import { HttpError } from '../utils/http-error';

export type SeekingAlphaOperationErrorCode =
  | 'SOURCE_DISABLED'
  | 'SESSION_MISSING'
  | 'SESSION_EXPIRED'
  | 'CHALLENGE_REQUIRED'
  | 'QUEUE_FULL'
  | 'CIRCUIT_OPEN'
  | 'UPSTREAM_UNAVAILABLE'
  | 'HYDRATION_TIMEOUT'
  | 'UNSUPPORTED_STATE'
  | 'SELECTOR_DRIFT';

export interface SeekingAlphaSessionMetadata {
  importedAt: string;
  lastVerifiedAt?: string;
}

const details: Record<SeekingAlphaOperationErrorCode, { message: string; statusCode: number }> = {
  SOURCE_DISABLED: { message: 'Seeking Alpha source is disabled', statusCode: 503 },
  SESSION_MISSING: { message: 'Seeking Alpha session is missing', statusCode: 409 },
  SESSION_EXPIRED: { message: 'Seeking Alpha session has expired', statusCode: 409 },
  CHALLENGE_REQUIRED: {
    message: 'Seeking Alpha requires manual verification',
    statusCode: 409,
  },
  QUEUE_FULL: { message: 'Seeking Alpha operation queue is full', statusCode: 503 },
  CIRCUIT_OPEN: {
    message: 'Seeking Alpha operations are temporarily unavailable',
    statusCode: 503,
  },
  UPSTREAM_UNAVAILABLE: { message: 'Seeking Alpha is unavailable', statusCode: 503 },
  HYDRATION_TIMEOUT: { message: 'Seeking Alpha values did not finish loading', statusCode: 504 },
  UNSUPPORTED_STATE: {
    message: 'Seeking Alpha does not provide a supported rating',
    statusCode: 422,
  },
  SELECTOR_DRIFT: { message: 'Seeking Alpha page structure changed', statusCode: 502 },
};

export class SeekingAlphaOperationError extends HttpError {
  constructor(
    public readonly operationCode: SeekingAlphaOperationErrorCode,
    public readonly sessionMetadata?: SeekingAlphaSessionMetadata
  ) {
    const detail = details[operationCode];
    super(detail.statusCode, detail.message, operationCode);
    this.name = 'SeekingAlphaOperationError';
    Object.setPrototypeOf(this, SeekingAlphaOperationError.prototype);
  }
}
