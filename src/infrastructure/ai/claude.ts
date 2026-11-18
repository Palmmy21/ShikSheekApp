/**
 * Optional Claude layer. Two narrow jobs, both with short timeouts and no retries:
 *   1. interpret(): turn chat text the rule-based parser didn't understand into a structured PROPOSAL.
 *   2. phrase():    write one short, playful Thai line for a situation (no numbers).
 *
 * It never sees other users' data, never writes to the database and never computes money.
 * Every result is re-validated by application code; on any error/timeout/refusal the caller falls
 * back to the rule-based behaviour.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AiIntentSchema, bytesToBase64, DocExtractionSchema, EXTRACT_SYSTEM, INTERPRET_SYSTEM, PHRASE_SYSTEM, type AiClient } from './contract.ts';

export * from './contract.ts';

export function createClaudeAi(opts: { apiKey: string; model: string; timeoutMs?: number }): AiClient {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 8_000, maxRetries: 0 });

  return {
    async interpret(text) {
      try {
        const response = await client.beta.messages.parse({
          model: opts.model,
          max_tokens: 1_024,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: betaZodOutputFormat(AiIntentSchema) },
          system: INTERPRET_SYSTEM,
          messages: [{ role: 'user', content: text.slice(0, 500) }],
        });
        if (response.stop_reason === 'refusal') return null;
        return response.parsed_output ?? null;
      } catch {
        return null;
      }
    },

    async extractDocument(bytes, mediaType) {
      try {
        const data = bytesToBase64(bytes);
        const source =
          mediaType === 'application/pdf'
            ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
            : ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } } as const);
        const response = await client.beta.messages.parse(
          {
            model: opts.model,
            max_tokens: 16_000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium', format: betaZodOutputFormat(DocExtractionSchema) },
            system: EXTRACT_SYSTEM,
            messages: [{ role: 'user', content: [source, { type: 'text', text: 'Extract the money movements from this document.' }] }],
          },
          { timeout: 90_000 },
        );
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
        return response.parsed_output ?? null;
      } catch {
        return null;
      }
    },

    async phrase(situation, example) {
      try {
        const response = await client.beta.messages.create({
          model: opts.model,
          max_tokens: 512,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: PHRASE_SYSTEM,
          messages: [{ role: 'user', content: `Situation: ${situation}\nExample of the tone: ${example}` }],
        });
        if (response.stop_reason === 'refusal') return null;
        const block = response.content.find((b) => b.type === 'text');
        return block && block.type === 'text' ? block.text.trim() : null;
      } catch {
        return null;
      }
    },
  };
}
