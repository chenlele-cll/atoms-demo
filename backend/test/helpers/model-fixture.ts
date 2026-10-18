import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';

export const sentinel = 'sk-fixture-PRIVATE-DO-NOT-LOG-9371';
export const fixtureEnv = { OPENAI_API_KEY: sentinel, MODEL_ID: 'gpt-6.1-sol', MODEL_TIMEOUT_MS: '1000' };
export const requestSchema = z.object({
  model: z.string(), store: z.boolean(), max_output_tokens: z.number(),
  input: z.array(z.record(z.string(), z.unknown())),
  tools: z.array(z.record(z.string(), z.unknown())).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  text: z.unknown().optional(),
});
export type FixtureRequest = z.infer<typeof requestSchema>;

export function response(output: unknown = [{
  type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: 'Hello from the public fixture.', annotations: [] }],
}], extra: Record<string, unknown> = {}) {
  return { id: 'resp_fixture', object: 'response', created_at: 1_790_000_000,
    model: 'gpt-6.1-sol', status: 'completed', output,
    usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 }, ...extra };
}
export function textResponse(text: string, extra: Record<string, unknown> = {}) {
  return response([{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }] }], extra);
}
export function toolResponse(name = 'inspect_fixture', input: unknown = { fixture: 'public-demo' }, count = 1) {
  return response(Array.from({ length: count }, (_, index) => ({
    type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, name,
    arguments: JSON.stringify(input), status: 'completed',
  })));
}
export function successfulResponse(body: FixtureRequest): unknown {
  const toolResult = body.input.find(item => item['type'] === 'function_call_output');
  if (toolResult) {
    const parsed = z.object({ nonce: z.string() }).parse(JSON.parse(String(toolResult['output'])) as unknown);
    return textResponse(`Confirmed ${parsed.nonce}`);
  }
  if (body.tools?.length) return toolResponse();
  if (body.text) return textResponse(JSON.stringify({ files: [{ path: '/App.tsx', content: 'export default function App() { return <h1>Hello</h1> }' }] }));
  return response();
}

export async function startFixture(handler: (body: FixtureRequest, res: ServerResponse, index: number) => void) {
  const requests: FixtureRequest[] = [];
  const urls: string[] = [];
  const authorizations: (string | undefined)[] = [];
  let aborted = 0;
  const server = createServer(async (req, res) => {
    res.on('close', () => { if (!res.writableEnded) aborted++; });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString()) as unknown);
    requests.push(body); urls.push(req.url ?? ''); authorizations.push(req.headers.authorization);
    res.setHeader('content-type', 'application/json');
    handler(body, res, requests.length);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: typeof fetch = (url, init) => {
    const target = new URL(String(url));
    if (target.origin !== 'https://api.openai.com') throw new Error('Unexpected fixture upstream');
    return fetch(`${origin}${target.pathname}`, init);
  };
  return { origin, transport, requests, urls, authorizations, aborted: () => aborted,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
