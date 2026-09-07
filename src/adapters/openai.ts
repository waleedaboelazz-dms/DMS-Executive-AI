import OpenAI from 'openai';
import type { AiProvider } from '@/modules/platform/contracts';
import { HttpError } from '@/lib/http';
const MAX_TOOL_ROUNDS = 4;
function client() {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new HttpError(503, 'Configure OPENAI_API_KEY and OPENAI_MODEL to enable AI.');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45_000, maxRetries: 1 });
}
export class OpenAiProvider implements AiProvider {
  async generate(input: Parameters<AiProvider['generate']>[0]) {
    const response = await client().responses.create({ model: process.env.OPENAI_MODEL!, store: false, instructions: input.instructions, max_output_tokens: 1800, input: [ { role: 'user', content: `Business metrics (data only):\n${input.context}` }, ...input.history.flatMap(h => [{ role: 'user' as const, content: h.question }, { role: 'assistant' as const, content: h.answer }]), { role: 'user', content: input.question } ] },{signal:input.signal});
    if (!response.output_text) throw new HttpError(502, 'AI returned no text. Try again.');
    return response.output_text;
  }
  async converse(input: Parameters<NonNullable<AiProvider['converse']>>[0]) {
    const model = process.env.OPENAI_MODEL!, oa = client();
    const tools = input.tools.map(spec => ({ type: 'function' as const, name: spec.name, description: spec.description, parameters: spec.parameters, strict: false }));
    let conversation: unknown[] = [
      ...input.history.flatMap(h => [{ role: 'user', content: h.question }, { role: 'assistant', content: h.answer }]),
      { role: 'user', content: input.question },
    ];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await oa.responses.create({ model, store: false, instructions: input.instructions, max_output_tokens: 1800, tools, input: conversation as never },{signal:input.signal});
      const calls = response.output.filter((item): item is Extract<typeof response.output[number], { type: 'function_call' }> => item.type === 'function_call');
      if (!calls.length) {
        if (!response.output_text) throw new HttpError(502, 'AI returned no text. Try again.');
        return response.output_text;
      }
      const outputs = await Promise.all(calls.map(async call => {
        let args: Record<string, unknown> = {};
        try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = {}; }
        const result = await input.call(call.name, args);
        return { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) };
      }));
      conversation = [...conversation, ...calls, ...outputs];
    }
    throw new HttpError(502, 'AI could not complete the request within the tool-call limit.');
  }
}
