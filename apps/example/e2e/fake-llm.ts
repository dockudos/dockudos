import type { APIRequestContext } from '@playwright/test';

export const FAKE_LLM = 'http://127.0.0.1:4399';

interface Call {
  authorization?: string;
  body: {
    tools?: unknown;
    messages: { role: string; content: string }[];
    [key: string]: unknown;
  };
}

/**
 * What the fake model was sent that mentions `needle` in its last message. Tests share the fake model and run
 * side by side, so each looks only at the requests about its own question.
 */
export async function modelCalls(
  request: APIRequestContext,
  needle: string,
): Promise<Call[]> {
  const all = (await (
    await request.get(`${FAKE_LLM}/__calls`)
  ).json()) as Call[];
  return all.filter((c) => c.body.messages.at(-1)?.content.includes(needle));
}
