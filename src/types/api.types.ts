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
