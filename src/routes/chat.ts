import { Hono } from 'hono';
import type { AppEnv, ChatResponse, ChatRequest } from '../types';
import { chatRequestSchema } from '../utils/validation';
import { AppError, ErrorCode } from '../utils/errors';
import { formatChatContext } from '../services/log-formatter';
import { buildChatMessages } from '../services/prompt-builder';
import { callOpenAI } from '../services/openai';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rate-limit';

const chat = new Hono<AppEnv>();

chat.post(
  '/chat',
  authMiddleware,
  rateLimitMiddleware({ dailyLimit: 100, endpoint: 'chat' }),
  async (c) => {
    const body = await c.req.json<ChatRequest>().catch(() => {
      throw new AppError(ErrorCode.INVALID_REQUEST);
    });

    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.INVALID_REQUEST, parsed.error.issues[0]?.message);
    }

    const { baby, messages: userMessages, activityLogs } = parsed.data;

    // Format logs to date-grouped Japanese text
    const context = formatChatContext(baby, activityLogs);

    // Build prompt with conversation history and call OpenAI
    const messages = buildChatMessages(context, userMessages);
    const replyText = await callOpenAI(c.env.OPENAI_API_KEY, 'gpt-4o', messages);

    return c.json<ChatResponse>({
      message: {
        role: 'assistant',
        content: replyText,
      },
      generatedAt: new Date().toISOString(),
    });
  },
);

export { chat };
