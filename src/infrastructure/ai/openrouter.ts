/**
 * OpenRouter provider (OpenAI-compatible Chat Completions). Same contract as the Claude client:
 * identical prompts and schemas, strict JSON-schema output, short timeouts, no retries, and every
 * response re-validated with Zod — anything malformed becomes null and the caller falls back.
 * Docs: https://openrouter.ai/docs (chat completions, structured outputs, images, PDFs)
 */
import * as z from 'zod/v4';
import {
  AiIntentSchema,
  bytesToBase64,
  DocExtractionSchema,
  EXTRACT_SYSTEM,
  INTERPRET_SYSTEM,
  PHRASE_SYSTEM,
  type AiClient,
} from './contract.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  error?: { message?: string };
}

/** Zod → JSON Schema accepted by strict structured outputs (no extra keys anywhere). */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'object') n.additionalProperties = false;
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(json);
  return json;
}

/** Content may arrive wrapped in ```json fences on some providers. */
export function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

export function createOpenRouterAi(opts: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  siteUrl?: string;
  fetchImpl?: typeof fetch;
}): AiClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function chat(body: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'ShikSheek',
          ...(opts.siteUrl ? { 'HTTP-Referer': opts.siteUrl } : {}),
        },
        body: JSON.stringify({ model: opts.model, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ChatResponse;
      const choice = data.choices?.[0];
      if (!choice || choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') return null;
      return choice.message?.content ?? null;
    } catch {
      return null;
    }
  }

  async function structured<T extends z.ZodType>(schema: T, name: string, system: string, user: string | ContentPart[], maxTokens: number, timeoutMs: number): Promise<z.output<T> | null> {
    const content = await chat(
      {
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: strictJsonSchema(schema) } },
        provider: { require_parameters: true }, // only route to providers that honour response_format
      },
      timeoutMs,
    );
    if (!content) return null;
    try {
      const parsed = schema.safeParse(extractJson(content));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  return {
    interpret(text) {
      return structured(AiIntentSchema, 'intent', INTERPRET_SYSTEM, text.slice(0, 500), 1_024, opts.timeoutMs ?? 8_000);
    },

    extractDocument(bytes, mediaType) {
      const dataUrl = `data:${mediaType};base64,${bytesToBase64(bytes)}`;
      const part: ContentPart =
        mediaType === 'application/pdf'
          ? { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } }
          : { type: 'image_url', image_url: { url: dataUrl } };
      return structured(
        DocExtractionSchema,
        'document_extraction',
        EXTRACT_SYSTEM,
        [{ type: 'text', text: 'Extract the money movements from this document.' }, part],
        16_000,
        90_000,
      );
    },

    async phrase(situation, example) {
      const content = await chat(
        {
          max_tokens: 200,
          messages: [
            { role: 'system', content: PHRASE_SYSTEM },
            { role: 'user', content: `Situation: ${situation}\nExample of the tone: ${example}` },
          ],
        },
        opts.timeoutMs ?? 8_000,
      );
      return content ? content.trim() : null;
    },
  };
}
