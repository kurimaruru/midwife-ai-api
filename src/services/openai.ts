import type { OpenAIMessage } from './prompt-builder';
import { AppError, ErrorCode } from '../utils/errors';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

type OpenAIModel = 'gpt-4o-mini' | 'gpt-4o';

type ChatCompletionResponse = {
  choices: { message: { content: string } }[];
};

export async function callOpenAI(
  apiKey: string,
  model: OpenAIModel,
  messages: OpenAIMessage[],
): Promise<string> {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`OpenAI API error: ${response.status} ${body}`);
    throw new AppError(ErrorCode.AI_SERVICE_ERROR);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError(ErrorCode.AI_SERVICE_ERROR, 'AIからの応答が空でした。');
  }

  return content;
}
