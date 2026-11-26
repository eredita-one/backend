import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Loga método, rota, status e duração quando a resposta termina. */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction) {
    const startedAt = performance.now();
    response.on('finish', () => {
      const ms = Math.round(performance.now() - startedAt);
      this.logger.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${ms}ms`,
      );
    });
    next();
  }
}
