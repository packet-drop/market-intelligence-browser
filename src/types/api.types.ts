export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta: {
    count?: number;
    durationMs: number;
    timestamp: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  meta: {
    durationMs: number;
    timestamp: string;
  };
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  environment: string;
  timestamp: string;
}

export interface BrowserSmokeResult {
  browser: 'chromium';
  launched: true;
  headless: boolean;
  version: string;
}

export type SeekingAlphaSessionState =
  'VALID' | 'MISSING' | 'EXPIRED' | 'CHALLENGE_REQUIRED' | 'UNAVAILABLE';

export interface SeekingAlphaSessionCheckResult {
  state: SeekingAlphaSessionState;
  checkedAt: string;
  importedAt?: string;
  lastVerifiedAt?: string;
  reason?:
    | 'SOURCE_DISABLED'
    | 'SESSION_FILE_MISSING'
    | 'LOGIN_REQUIRED'
    | 'UPSTREAM_CHALLENGE'
    | 'UPSTREAM_UNAVAILABLE'
    | 'QUEUE_FULL'
    | 'CIRCUIT_OPEN';
}

export interface SeekingAlphaSessionImportResult {
  importedAt: string;
}
