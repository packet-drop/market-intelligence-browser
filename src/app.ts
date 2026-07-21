import 'dotenv/config';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorMiddleware } from './middlewares/error.middleware';
import { notFoundMiddleware } from './middlewares/not-found.middleware';
import { requestLoggerMiddleware } from './middlewares/request-logger.middleware';
import { rateLimitMiddleware } from './middlewares/rate-limit.middleware';
import {
  securityMiddleware,
  corsMiddleware,
  compressionMiddleware,
} from './middlewares/security.middleware';
import { bearerAuthMiddleware } from './middlewares/bearer-auth.middleware';
import healthRoutes from './routes/health.routes';
import browserRoutes from './routes/browser.routes';

export const createApp = (): express.Express => {
  const app = express();

  // Trust proxy
  app.set('trust proxy', 1);

  // Security middleware
  app.use(securityMiddleware);
  app.use(corsMiddleware);
  app.use(compressionMiddleware);

  // Request logging
  app.use(requestLoggerMiddleware);

  // Public, dependency-free health endpoint
  app.use('/health', healthRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(rateLimitMiddleware);

  // Root endpoint redirects users to interactive API documentation
  app.get('/', (_req, res) => {
    return res.redirect('/docs');
  });

  // Swagger/OpenAPI documentation
  app.get('/openapi.json', (_req, res) => {
    return res.json(swaggerSpec);
  });

  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Market Intelligence Browser API',
      swaggerOptions: {
        persistAuthorization: true,
      },
    })
  );

  // All application API routes require bearer authentication.
  app.use('/api', bearerAuthMiddleware);
  app.use('/api/browser', browserRoutes);

  // 404 handler
  app.use(notFoundMiddleware);

  // Error handling middleware (must be last)
  app.use(errorMiddleware);

  return app;
};
