import { describe, expect, it } from 'vitest';
import { createAiFromConfig } from '../../src/app.ts';
import { DocExtractionSchema } from '../../src/infrastructure/ai/contract.ts';
import { createOpenRouterAi, extractJson, strictJsonSchema } from '../../src/infrastructure/ai/openrouter.ts';

function fakeFetch(reply: { status?: number; content?: string | null; finish?: string; throws?: boolean }) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    if (reply.throws) throw new Error('network');
    return new Response(JSON.stringify({ choices: [{ message: { content: reply.content ?? null }, finish_reason: reply.finish ?? 'stop' }] }), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const slipJson = JSON.stringify({ kind: 'transfer_slip', rows: [{ type: 'expense', amount_text: '1,250.00', date: '2026-11-17', description: 'ร้านกาแฟ', category_id: 'food', reference: 'ABC123456' }] });

describe('OpenRouter client', () => {
  it('sends a strict json_schema request with the image as a data URL and the key as Bearer', async () => {
    const { f, calls } = fakeFetch({ content: slipJson });
    const ai = createOpenRouterAi({ apiKey: 'sk-or-test', model: 'anthropic/claude-opus-5.5', fetchImpl: f });
    const out = await ai.extractDocument(new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(out?.rows[0]?.amount_text).toBe('1,250.00');

    const { url, init, body } = calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    expect(body.model).toBe('anthropic/claude-opus-5.5');
    expect(body.provider).toEqual({ require_parameters: true });
    const rf = body.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.strict).toBe(true);
    const parts = (body.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/jpeg;base64,AQID');
  });

  it('sends PDFs as a file part', async () => {
    const { f, calls } = fakeFetch({ content: slipJson });
    await createOpenRouterAi({ apiKey: 'k', model: 'm', fetchImpl: f }).extractDocument(new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    const parts = (calls[0]!.body.messages as Array<{ content: unknown }>)[1]!.content as Array<{ type: string; file?: { file_data: string } }>;
    expect(parts.find((p) => p.type === 'file')?.file?.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('returns null (→ rule-based fallback) on HTTP errors, network errors, truncation, bad JSON or schema mismatch', async () => {
    const cases = [
      { status: 402, content: slipJson },
      { throws: true },
      { content: slipJson, finish: 'length' },
      { content: 'not json' },
      { content: JSON.stringify({ kind: 'transfer_slip', rows: [{ amount_text: 5 }] }) },
      { content: null },
    ];
    for (const c of cases) {
      const ai = createOpenRouterAi({ apiKey: 'k', model: 'm', fetchImpl: fakeFetch(c).f });
      expect(await ai.extractDocument(new Uint8Array([1]), 'image/png')).toBeNull();
      expect(await ai.interpret('ข้าว 50')).toBeNull();
    }
  });

  it('accepts JSON wrapped in code fences', async () => {
    const ai = createOpenRouterAi({ apiKey: 'k', model: 'm', fetchImpl: fakeFetch({ content: '```json\n' + slipJson + '\n```' }).f });
    expect((await ai.extractDocument(new Uint8Array([1]), 'image/png'))?.kind).toBe('transfer_slip');
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strict schema forbids additional properties at every object level', () => {
    const s = strictJsonSchema(DocExtractionSchema) as { additionalProperties: boolean; properties: { rows: { items: { additionalProperties: boolean } } } };
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.rows.items.additionalProperties).toBe(false);
  });
});

describe('provider selection', () => {
  it('picks OpenRouter when its key is set, Anthropic otherwise, none without keys', () => {
    expect(createAiFromConfig({})).toBeUndefined();
    expect(createAiFromConfig({ OPENROUTER_API_KEY: 'k' })).toBeDefined();
    expect(createAiFromConfig({ ANTHROPIC_API_KEY: 'k' })).toBeDefined();
    expect(createAiFromConfig({ AI_PROVIDER: 'anthropic', OPENROUTER_API_KEY: 'k' })).toBeUndefined(); // asked for anthropic, no anthropic key
  });
});
