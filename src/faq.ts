import { readFileSync } from 'node:fs';

export interface FaqItem {
  question: string;
  answer: string;
}

/** Everything the customer reads. Lives in faq.json so it can be edited without touching code. */
export interface Faq {
  welcome: string;
  humanButton: string;
  humanPrompt: string;
  backButton: string;
  messageReceived: string;
  deliveryFailed: string;
  items: FaqItem[];
}

const TEXT_FIELDS = ['welcome', 'humanButton', 'humanPrompt', 'backButton', 'messageReceived', 'deliveryFailed'] as const;

// Telegram limits: button labels are best kept short, message texts max 4096 chars.
const MAX_BUTTON_LENGTH = 64;
const MAX_TEXT_LENGTH = 4096;

export function parseFaq(raw: string, source = 'faq.json'): Faq {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${(err as Error).message}`);
  }
  if (!isObject(data)) throw new Error(`${source} must contain a JSON object.`);

  for (const field of TEXT_FIELDS) {
    requireText(data[field], `${source}: "${field}"`, MAX_TEXT_LENGTH);
  }
  requireText(data.humanButton, `${source}: "humanButton"`, MAX_BUTTON_LENGTH);
  requireText(data.backButton, `${source}: "backButton"`, MAX_BUTTON_LENGTH);

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error(`${source}: "items" must be a non-empty list of { "question", "answer" }.`);
  }
  const items = data.items.map((item: unknown, i: number): FaqItem => {
    const where = `${source}: items[${i}]`;
    if (!isObject(item)) throw new Error(`${where} must be an object with "question" and "answer".`);
    return {
      question: requireText(item.question, `${where}.question`, MAX_BUTTON_LENGTH),
      answer: requireText(item.answer, `${where}.answer`, MAX_TEXT_LENGTH),
    };
  });

  return {
    welcome: data.welcome as string,
    humanButton: data.humanButton as string,
    humanPrompt: data.humanPrompt as string,
    backButton: data.backButton as string,
    messageReceived: data.messageReceived as string,
    deliveryFailed: data.deliveryFailed as string,
    items,
  };
}

export function loadFaq(filePath: string): Faq {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read FAQ file at ${filePath}: ${(err as Error).message}`);
  }
  return parseFaq(raw, filePath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, where: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${where} is too long (${value.length} chars, max ${maxLength}).`);
  }
  return value;
}
