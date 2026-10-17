// The AI providers the user can connect. Nothing else in the extension knows a concrete one:
// ai/background.js talks to this interface only.
//
// To add a provider, write a module here that exports an object of this shape and list it below.

import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { nvidia } from './nvidia.js';
import { ollama } from './ollama.js';
import { openai } from './openai.js';

/**
 * @typedef {Object} AiProvider
 * @property {string} id
 * @property {string} name
 * @property {boolean} needsKey        Whether nothing works without an API key.
 * @property {boolean} needsBase       Whether the user gives the address (config.baseUrl).
 * @property {string} defaultModel     '' where there is no sensible default: the user types one.
 * @property {string} defaultBase
 * @property {string} keyPage          Where a key is made ('' if there is no such page).
 * @property {number} [timeoutMs]      If answers take longer here than elsewhere.
 * @property {number} [pageChunkChars] The same for translating a page (ai/page-translate.js).
 * @property {(config: AiSettings) => string[]} origins
 *   The host permissions a request with this configuration needs (match patterns).
 * @property {(request: { system: string, prompt: string, maxTokens: number, image?: { mime: string, data: string } | null, json?: JsonRequest | null, temperature?: number }, config: AiSettings, options?: { signal?: AbortSignal | null, timeoutMs?: number }) => Promise<string>} generate
 *   `image`: a picture sent along with the prompt (base64 `data`), for models that read pictures.
 *   `json`: ask for JSON in the way this provider offers (see JsonRequest); a provider that
 *   cannot do the mode asked for sends the request without it, and the answer is checked anyway.
 *   `temperature`: sent where the provider and its current models accept one, left out elsewhere.
 *   One answer as plain text. Rejects with a WordvaultError: 'network', 'timeout', 'aborted'
 *   (lib/errors.js) or one of the `ai_*` codes (providers/shared.js).
 *
 * @typedef {{ apiKey: string, model: string, baseUrl: string }} AiSettings
 *
 * @typedef {Object} JsonRequest
 * @property {'schema' | 'object'} mode  'schema': the answer is held to `schema` by the provider;
 *           'object': only valid JSON is asked for (for services that refuse the schema).
 * @property {string} name     A name for the schema, where the provider wants one ([A-Za-z0-9_-]).
 * @property {object} schema   JSON Schema of the answer, in the subset all providers accept.
 */

/** @type {Map<string, AiProvider>} */
const providers = new Map([gemini, anthropic, nvidia, openai, ollama].map((provider) => [provider.id, provider]));

/** @returns {AiProvider | null} */
export const getAiProvider = (id) => providers.get(id) || null;

/** @returns {AiProvider[]} */
export const listAiProviders = () => [...providers.values()];
