import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'Market Intelligence Browser API',
      version: '1.0.0',
      description:
        'A narrowly scoped, authenticated browser automation service for investment-intelligence workflows.',
      license: { name: 'MIT' },
    },
    servers: [
      {
        url: '/',
        description: 'Current origin',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API key',
          description: 'Set the token to the SERVICE_API_KEY configured for this service.',
        },
      },
      schemas: {
        Meta: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            durationMs: { type: 'integer' },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['durationMs', 'timestamp'],
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: { type: 'string' },
            meta: { $ref: '#/components/schemas/Meta' },
          },
          required: ['success', 'error', 'meta'],
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'unhealthy'] },
            uptime: { type: 'number' },
            environment: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['status', 'uptime', 'environment', 'timestamp'],
        },
        BrowserSmokeResult: {
          type: 'object',
          properties: {
            browser: { type: 'string', enum: ['chromium'] },
            launched: { type: 'boolean', enum: [true] },
            headless: { type: 'boolean' },
            version: { type: 'string' },
          },
          required: ['browser', 'launched', 'headless', 'version'],
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
