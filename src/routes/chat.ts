import { Hono } from 'hono';
import type { AppEnv, ChatResponse, ChatRequest } from '../types';
import { chatRequestSchema } from '../utils/validation';
import { AppError, ErrorCode } from '../utils/errors';
import { formatChatContext } from '../services/log-formatter';
import { buildChatInstructions } from '../services/prompt-builder';
import { callOpenAIResponses, callOpenAIResponsesStream } from '../services/openai';
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

    const { baby, message, previousResponseId, activityLogs, stream } = parsed.data;

    // Format logs to date-grouped Japanese text
    const context = formatChatContext(baby, activityLogs);

    // Build instructions and call OpenAI Responses API
    const instructions = buildChatInstructions(context);

    // SSE streaming response
    if (stream) {
      const readable = callOpenAIResponsesStream(
        c.env.OPENAI_API_KEY,
        instructions,
        message,
        previousResponseId,
      );
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Non-streaming response
    const result = await callOpenAIResponses(
      c.env.OPENAI_API_KEY,
      instructions,
      message,
      previousResponseId,
    );

    return c.json<ChatResponse>({
      message: {
        role: 'assistant',
        content: result.content,
      },
      responseId: result.responseId,
      generatedAt: new Date().toISOString(),
    });
  },
);

export { chat };
