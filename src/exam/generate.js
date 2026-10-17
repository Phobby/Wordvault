// Turning a plan into a test: ask, read the JSON, check every question, and ask again where it
// is worth it: once if the answer could not be read at all, and once more for the questions
// that had to be left out. What survives is the test; a test with fewer questions than planned
// says so. The provider is behind `ask`, so this runs the same in tests.

import { examPrompt } from './prompt.js';
import { extractJson, inPlanOrder, validateExam } from './schema.js';
import { WordvaultError } from '../lib/errors.js';

/**
 * @param {Object} input
 * @param {{ id: string, word: string, meaning: string }[]} input.words  wordData() of the selection.
 * @param {{ alias: string, entryId: string, type: string }[]} input.plan
 * @param {string} input.language  The language tested.
 * @param {string} input.level     CEFR level.
 * @param {string} input.explanationLang  The language explanations are written in.
 * @param {(prompt: { system: string, prompt: string }) => Promise<string>} input.ask  One request to the provider.
 * @param {(step: 'asking' | 'checking' | 'retrying' | 'topping-up') => void} [input.onStep]
 * @returns {Promise<{ questions: object[], requested: number, dropped: number }>}
 *          Rejects with WordvaultError 'exam_parse' (the answer was never readable) or
 *          'exam_empty' (not one question passed the checks).
 */
export async function generateExam({ words, plan, language, level, explanationLang, ask, onStep = () => {} }) {
  const byAlias = new Map(words.map((word) => [word.id, word]));
  const context = { words: byAlias, language };

  /** One round: the prompt for `part` of the plan; asked a second time if it cannot be read. */
  async function round(part) {
    const prompt = examPrompt({ words: words.filter((word) => part.some(({ alias }) => alias === word.id)), plan: part, language, level, explanationLang });
    let reason = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) onStep('retrying');
      const text = await ask(prompt);
      onStep('checking');
      const parsed = extractJson(text);
      if (parsed.error) {
        reason = parsed.error;
        continue;
      }
      const checked = validateExam(parsed.value, { plan: part, ...context });
      if (!checked.ok) {
        reason = checked.error;
        continue;
      }
      return checked;
    }
    throw new WordvaultError('exam_parse', reason);
  }

  onStep('asking');
  const first = await round(plan);
  let questions = first.questions;
  let dropped = first.dropped.length;
  const missing = () => plan.filter(({ alias, type }) => !questions.some((question) => question.wordId === alias && question.type === type));

  // Questions were left out: ask once more for exactly those.
  if (missing().length > 0) {
    onStep('topping-up');
    try {
      const again = await round(missing());
      questions = [...questions, ...again.questions];
      dropped += again.dropped.length;
    } catch (error) {
      // What there is already is kept; only a cancellation ends the whole test.
      if (error?.code === 'aborted') throw error;
    }
  }
  if (questions.length === 0) throw new WordvaultError('exam_empty', `${dropped} question(s) failed the checks`);
  return { questions: inPlanOrder(questions, plan), requested: plan.length, dropped };
}
