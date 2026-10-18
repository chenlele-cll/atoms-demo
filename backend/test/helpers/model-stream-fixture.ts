import type { ServerResponse } from 'node:http';
import { z } from 'zod';

const object = z.record(z.string(), z.unknown());
export function streamEvents(value: unknown): Record<string, unknown>[] {
  const body = object.parse(value);
  const output = z.array(object).parse(body['output']);
  const events: Record<string, unknown>[] = [{ type: 'response.created', response: { ...body, status: 'in_progress', output: [] } }];
  for (const [index, item] of output.entries()) {
    events.push({ type: 'response.output_item.added', output_index: index, item: { ...item, status: 'in_progress', ...(item['type'] === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item['type'] === 'function_call') {
      const input = z.string().parse(item['arguments']);
      const split = Math.max(1, Math.floor(input.length / 2));
      for (const delta of [input.slice(0, split), input.slice(split)]) events.push({ type: 'response.function_call_arguments.delta', output_index: index, item_id: item['id'], delta });
      events.push({ type: 'response.function_call_arguments.done', output_index: index, item_id: item['id'], arguments: input });
    } else if (item['type'] === 'message') {
      const content = z.array(object).parse(item['content']);
      for (const [contentIndex, part] of content.entries()) {
        events.push({ type: 'response.content_part.added', output_index: index, content_index: contentIndex, item_id: item['id'], part: { ...part, text: '' } });
        if (part['type'] === 'output_text') events.push({ type: 'response.output_text.delta', output_index: index, content_index: contentIndex, item_id: item['id'], delta: part['text'], logprobs: [] });
      }
    }
    events.push({ type: 'response.output_item.done', output_index: index, item });
  }
  events.push({ type: `response.${String(body['status'])}`, response: body });
  return events;
}

export function writeEvent(res: ServerResponse, event: Record<string, unknown>, sequence: number) {
  res.write(`event: ${String(event['type'])}\ndata: ${JSON.stringify({ sequence_number: sequence, ...event })}\n\n`);
}
export function writeStream(res: ServerResponse, value: unknown) {
  res.setHeader('content-type', 'text/event-stream');
  streamEvents(value).forEach((event, index) => writeEvent(res, event, index));
  res.end();
}
