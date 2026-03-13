import { Hono } from 'hono';
import type { AppEnv, AdviceResponse, AdviceRequest } from '../types';
import { adviceRequestSchema } from '../utils/validation';
import { AppError, ErrorCode } from '../utils/errors';
import { formatDailySummary } from '../services/log-formatter';
import { buildAdviceMessages } from '../services/prompt-builder';
import { callOpenAI } from '../services/openai';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rate-limit';

const advice = new Hono<AppEnv>();

advice.post(
  '/advice',
  authMiddleware,
  rateLimitMiddleware({ dailyLimit: 30, endpoint: 'advice' }),
  async (c) => {
    const body = await c.req.json<AdviceRequest>().catch(() => {
      throw new AppError(ErrorCode.INVALID_REQUEST);
    });

    const parsed = adviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.INVALID_REQUEST, parsed.error.issues[0]?.message);
    }

    const { baby, date, activityLogs } = parsed.data;

    // Format logs to Japanese text
    const summary = formatDailySummary(baby, date, activityLogs);

    // Build prompt and call OpenAI
    const messages = buildAdviceMessages(summary);
    const adviceText = await callOpenAI(c.env.OPENAI_API_KEY, 'gpt-4o-mini', messages);

    return c.json<AdviceResponse>({
      advice: adviceText,
      generatedAt: new Date().toISOString(),
    });
  },
);

export { advice };
