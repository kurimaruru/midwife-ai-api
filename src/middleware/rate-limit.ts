import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { AppError, ErrorCode } from '../utils/errors';

type RateLimitConfig = {
  dailyLimit: number;
  endpoint: string;
};

const BURST_LIMIT = 10; // 10 requests per minute
const BURST_WINDOW_SEC = 60;

/**
 * Get the current date in JST (UTC+9) as YYYY-MM-DD.
 */
function getJSTDate(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * Get seconds until JST midnight.
 */
function getSecondsUntilJSTMidnight(): number {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstMidnight = new Date(jstNow);
  jstMidnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((jstMidnight.getTime() - jstNow.getTime()) / 1000);
}

export function rateLimitMiddleware(config: RateLimitConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const transactionId = c.get('transactionId');
    const kv = c.env.RATE_LIMIT;
    const jstDate = getJSTDate();

    // Key patterns
    const dailyKey = `daily:${config.endpoint}:${transactionId}:${jstDate}`;
    const burstKey = `burst:${transactionId}:${Math.floor(Date.now() / 1000 / BURST_WINDOW_SEC)}`;

    // Read counters in parallel
    const [dailyCountStr, burstCountStr] = await Promise.all([
      kv.get(dailyKey),
      kv.get(burstKey),
    ]);

    const dailyCount = parseInt(dailyCountStr ?? '0', 10);
    const burstCount = parseInt(burstCountStr ?? '0', 10);

    // Check burst limit
    if (burstCount >= BURST_LIMIT) {
      throw new AppError(ErrorCode.RATE_LIMITED, undefined, BURST_WINDOW_SEC);
    }

    // Check daily limit
    if (dailyCount >= config.dailyLimit) {
      const retryAfter = getSecondsUntilJSTMidnight();
      throw new AppError(ErrorCode.RATE_LIMITED, undefined, retryAfter);
    }

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(config.dailyLimit));
    c.header('X-RateLimit-Remaining', String(config.dailyLimit - dailyCount - 1));
    // Reset timestamp: next JST midnight in epoch seconds
    const resetEpoch = Math.floor(Date.now() / 1000) + getSecondsUntilJSTMidnight();
    c.header('X-RateLimit-Reset', String(resetEpoch));

    await next();

    // Increment counters in background after response is sent
    const dailyTTL = getSecondsUntilJSTMidnight() + 3600; // +1h buffer
    c.executionCtx.waitUntil(
      Promise.all([
        kv.put(dailyKey, String(dailyCount + 1), { expirationTtl: dailyTTL }),
        kv.put(burstKey, String(burstCount + 1), { expirationTtl: BURST_WINDOW_SEC }),
      ]),
    );
  });
}
