import { Hono } from 'hono';
import type { AppEnv, HealthResponse } from '../types';

const health = new Hono<AppEnv>();

health.get('/health', (c) => {
  return c.json<HealthResponse>({
    status: 'ok',
    version: '1.0.0',
  });
});

export { health };
