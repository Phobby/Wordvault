// NVIDIA's API catalog (build.nvidia.com), with the user's own key ("nvapi-...").
//
// Checked on 2026-10-16 against NVIDIA's API reference (docs.api.nvidia.com/nim/reference/llm-apis):
//   - POST https://integrate.api.nvidia.com/v1/chat/completions: the OpenAI chat-completions
//     protocol (openai.js), `Authorization: Bearer <key>`;
//   - models are named `publisher/model`, e.g. deepseek-ai/deepseek-v4-flash.
//
// ASSUMPTION: the key format (nvapi-) and the key page come from build.nvidia.com and third-party
// guides; the reference page above does not state them.
//
// No default model: NVIDIA retires models from the hosted catalog without notice, and a retired
// one answers 410 Gone (meta/llama-3.3-70b-instruct, the first default here, went on 2026-08-26).
// The user copies the name from the model's page on build.nvidia.com instead.

// Many models in the catalog think before they answer (GLM, DeepSeek, Nemotron and others), and
// on some that is on by default. The thinking is streamed apart from the answer and never shown,
// but it is waited for: a short explanation then takes longer than the request may (z-ai/glm-5.3-flash
// passed the one-word test and timed out on real questions). NVIDIA's documentation for reasoning
// models switches it off with `chat_template_kwargs: { enable_thinking: false }`
// (docs.nvidia.com/nim/large-language-models/latest/reasoning-model.html).
// ASSUMPTION: every hosted model honours or ignores it; one that refuses the request because of
// it (400) is asked again without it.

import { chatCompletions } from './openai.js';

const BASE = 'https://integrate.api.nvidia.com/v1';
const NO_THINKING = { chat_template_kwargs: { enable_thinking: false } };

export const nvidia = {
  id: 'nvidia',
  name: 'NVIDIA',
  needsKey: true,
  needsBase: false,
  defaultModel: '',
  defaultBase: '',
  keyPage: 'https://build.nvidia.com/settings/api-keys',
  origins: () => ['https://integrate.api.nvidia.com/*'],

  async generate(request, config, options) {
    try {
      return await chatCompletions(new URL(BASE), request, config, options, NO_THINKING);
    } catch (error) {
      if (error?.code !== 'ai_request') throw error;
      return chatCompletions(new URL(BASE), request, config, options);
    }
  },
};
