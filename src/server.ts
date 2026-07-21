import { Server } from 'http';
import { createApp } from './app';
import logger from './config/logger';
import env from './config/env';
import { browserService } from './services/browser.service';

export const startServer = async (): Promise<Server> => {
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`Server started on http://${env.HOST}:${env.PORT}`);
    logger.info(`API Documentation: http://${env.HOST}:${env.PORT}/docs`);
    logger.info(`OpenAPI JSON: http://${env.HOST}:${env.PORT}/openapi.json`);
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, starting graceful shutdown...`);

    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        await browserService.close();
      } catch (error) {
        logger.error('Error closing browser:', error);
      }

      process.exit(0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });

  return server;
};

export default startServer;
