import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ModelSession } from './client.js';
import { ModelError } from './errors.js';

export const caseNames = ['text', 'files', 'tools'] as const;
export type CaseName = typeof caseNames[number];

export const fileSchema = z.strictObject({
  files: z.array(z.strictObject({ path: z.literal('/App.tsx'), content: z.string() })).length(1),
});
const fixtureInput = z.strictObject({ fixture: z.literal('public-demo') });

function finalText(result: Awaited<ReturnType<ModelSession['step']>>): string {
  if (result.finishReason !== 'stop' || result.toolCalls.length !== 0 || result.text.trim().length === 0) {
    throw new ModelError('invalid_output');
  }
  return result.text;
}

// Only summaries escape these cases. File bodies are never written or executed.
export async function runCase(name: CaseName, session: ModelSession) {
  if (name === 'text') {
    const result = await session.step({ messages: [{ role: 'user', content: 'Reply with one short greeting for a public API connectivity test.' }] });
    return { textCharacters: finalText(result).length };
  }
  if (name === 'files') {
    const result = await session.step({
      messages: [{ role: 'user', content: 'Return exactly one /App.tsx file containing a tiny React component with a default export and a public greeting. No imports or external services. Keep the file under 16 KiB.' }],
      schema: fileSchema,
    });
    finalText(result);
    const parsed = fileSchema.safeParse(result.output);
    if (!parsed.success) throw new ModelError('invalid_output');
    const file = parsed.data.files[0];
    if (!file || !file.content.trim() || Buffer.byteLength(file.content, 'utf8') > 16 * 1024) {
      throw new ModelError('invalid_output');
    }
    return { fileCount: 1, contentBytes: Buffer.byteLength(file.content, 'utf8') };
  }
  const messages = [{ role: 'user' as const, content: 'Call inspect_fixture exactly once with fixture public-demo. Then reply with the exact nonce returned by the tool. Do not invent a nonce.' }];
  const tools = { inspect_fixture: { description: 'Inspect public in-memory demo data.', inputSchema: fixtureInput } };
  // No automatic SDK execute: validate the entire call batch before one dispatch.
  const first = await session.step({ messages, tools, toolChoice: 'required' });
  if (first.toolCalls.length !== 1) throw new ModelError('invalid_output');
  const call = first.toolCalls[0];
  if (!call || call.toolName !== 'inspect_fixture' || ('invalid' in call && call.invalid) ||
      !fixtureInput.safeParse(call.input).success || first.finishReason !== 'tool-calls') {
    throw new ModelError('invalid_output');
  }
  session.check();
  // Created only during dispatch; not present in the first prompt/tool definition.
  const result = { fixture: 'public-demo', title: 'Atoms public fixture', nonce: randomUUID() };
  const final = await session.step({
    messages: [...messages, ...first.response.messages, {
      role: 'tool', content: [{ type: 'tool-result', toolCallId: call.toolCallId, toolName: 'inspect_fixture', output: { type: 'json', value: result } }],
    }],
    tools, toolChoice: 'none',
  });
  if (!finalText(final).includes(result.nonce)) throw new ModelError('invalid_output');
  return { toolExecutions: 1, confirmed: true };
}
