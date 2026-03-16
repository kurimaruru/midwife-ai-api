import type { OpenAIMessage } from './prompt-builder';
import { AppError, ErrorCode } from '../utils/errors';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';

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

type ResponsesAPIResponse = {
  id: string;
  output: { type: string; content: { type: string; text: string }[] }[];
};

export async function callOpenAIResponses(
  apiKey: string,
  instructions: string,
  input: string,
  previousResponseId?: string,
): Promise<{ responseId: string; content: string }> {
  const body: Record<string, unknown> = {
    model: 'gpt-4o',
    instructions,
    input,
    store: true,
    max_output_tokens: 500,
    temperature: 0.7,
  };
  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  const response = await fetch(OPENAI_RESPONSES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`OpenAI Responses API error: ${response.status} ${text}`);

    if (response.status === 404 && previousResponseId) {
      throw new AppError(
        ErrorCode.INVALID_REQUEST,
        '会話の有効期限が切れました。新しい会話を開始してください。',
      );
    }
    throw new AppError(ErrorCode.AI_SERVICE_ERROR);
  }

  const data = (await response.json()) as ResponsesAPIResponse;
  const textContent = data.output
    ?.find((o) => o.type === 'message')
    ?.content?.find((c) => c.type === 'output_text')?.text;

  if (!textContent) {
    throw new AppError(ErrorCode.AI_SERVICE_ERROR, 'AIからの応答が空でした。');
  }

  return { responseId: data.id, content: textContent };
}
