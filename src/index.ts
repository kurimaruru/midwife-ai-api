import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './types';
import { AppError, errorResponse } from './utils/errors';
import { health } from './routes/health';
import { advice } from './routes/advice';
import { chat } from './routes/chat';

const app = new Hono<AppEnv>();

// --- CORS ---
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// --- Global Error Handler ---
app.onError((err, c) => {
  if (err instanceof AppError) {
    return errorResponse(c, err);
  }

  console.error('Unhandled error:', err);
  return c.json(
    {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '予期しないエラーが発生しました。',
      },
    },
    500,
  );
});

// --- Routes ---
// Health check (no auth required)
app.route('/v1', health);

// Protected endpoints (auth + rate limit applied per route)
app.route('/v1', advice);
app.route('/v1', chat);

export default app;
