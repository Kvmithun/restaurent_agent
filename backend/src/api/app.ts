import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authRouter } from '../routes/auth.js';
import { platformRouter } from '../routes/platform.js';
import { aiRouter } from '../routes/ai.js';
import { adminRouter } from '../routes/admin.js';
import { env } from '../config/env.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api', platformRouter);
  app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const err = error as Error & { status?: number; code?: string; name?: string; errors?: Record<string, { message: string }> };
    if (err.name === 'MulterError') return response.status(400).json({ error: { code: 'UPLOAD_REJECTED', message: err.message } });
    if (err.name === 'ZodError') return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    if (err.name === 'ValidationError') return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    if (err.name === 'MongoServerError' && (err as Error & { code?: number }).code === 11000) return response.status(409).json({ error: { code: 'DUPLICATE_ACCOUNT', message: 'An account with these details already exists' } });
    const status = err.status ?? 500;
    if (status >= 500) console.error(JSON.stringify({ event: 'request.failed', errorName: err.name ?? 'Error', errorCode: err.code ?? 'INTERNAL_ERROR' }));
    return response.status(status).json({ error: { code: err.code ?? 'INTERNAL_ERROR', message: status >= 500 ? 'An unexpected error occurred' : err.message } });
  });
  return app;
}
