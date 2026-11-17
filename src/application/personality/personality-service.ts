/**
 * Personality service. Produces WORDS only — every number shown to the user comes from the
 * calculation engine and is rendered by templates, never by this service.
 *
 * Default implementation is rule-based. An AI-backed implementation (Phase 8) can wrap it and fall
 * back to it on any error or timeout.
 */
import { line, type Situation } from './rule-based.ts';

export interface PersonalityService {
  comment(situation: Situation, seed?: string): Promise<string>;
}

export function createRuleBasedPersonality(): PersonalityService {
  return {
    async comment(situation, seed = '') {
      return line(situation, seed);
    },
  };
}
