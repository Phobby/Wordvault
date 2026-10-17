// Limits of "Create a test with AI". Every number the feature depends on is here.

export const EXAM = Object.freeze({
  /** A language needs at least this many words that can be asked before a test is offered in it. */
  MIN_WORDS: 5,
  /** Questions in a test: what the form starts with, and the most it allows. */
  DEFAULT_QUESTIONS: 10,
  MAX_QUESTIONS: 20,
  /** At most this many words go to the provider for one test (a word may carry two questions). */
  MAX_WORDS: 20,
  /** Lengths of what is sent: a word and the user's translation of it. */
  WORD_CHARS: 60,
  TRANSLATION_CHARS: 80,
  /** Lengths of what is accepted back. */
  TEXT_CHARS: 300,
  ANSWER_CHARS: 60,
  EXPLANATION_CHARS: 400,
  ACCEPTABLE_ITEMS: 6,
  /** Tests kept on this device ("Past tests"); the oldest goes first. */
  HISTORY_ITEMS: 10,
  /** A ceiling for the answer; it also has to cover a model's thinking. */
  ANSWER_TOKENS: 8192,
  /** Low creativity where the provider takes a temperature. */
  TEMPERATURE: 0.2,
  /** The share of a test given to the words the scheduler finds hardest; the rest is drawn at random. */
  PRIORITY_SHARE: 0.5,
  /** A wrong answer counts as recent for this long. */
  RECENT_MS: 14 * 24 * 60 * 60 * 1000,
});

/** CEFR levels, in order. */
export const LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

/** The two kinds of question. */
export const FILL_BLANK = 'fill_blank';
export const TRUE_FALSE = 'true_false';
export const QUESTION_TYPES = Object.freeze([FILL_BLANK, TRUE_FALSE]);

/** What stands for the gap in a fill-in-the-blank sentence. */
export const BLANK = '____';
