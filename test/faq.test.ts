import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadFaq, parseFaq } from '../src/faq.ts';

const VALID = {
  welcome: 'Hi',
  humanButton: 'Talk to a person',
  humanPrompt: 'Type away',
  backButton: 'Back',
  messageReceived: 'Sent',
  deliveryFailed: 'Failed',
  items: [{ question: 'Q?', answer: 'A.' }],
};

function withChanges(changes: Record<string, unknown>): string {
  return JSON.stringify({ ...VALID, ...changes });
}

describe('FAQ loading', () => {
  it('loads the faq.json shipped with the project', () => {
    const faq = loadFaq(fileURLToPath(new URL('../faq.json', import.meta.url)));
    assert.ok(faq.items.length >= 3);
    for (const item of faq.items) {
      assert.ok(item.question && item.answer);
    }
  });

  it('parses a valid file', () => {
    const faq = parseFaq(JSON.stringify(VALID));
    assert.deepEqual(faq.items, [{ question: 'Q?', answer: 'A.' }]);
    assert.equal(faq.humanButton, 'Talk to a person');
  });

  it('explains broken JSON', () => {
    assert.throws(() => parseFaq('{ "welcome": "Hi", }'), /faq\.json is not valid JSON/);
  });

  it('names the missing field', () => {
    assert.throws(() => parseFaq(withChanges({ humanPrompt: undefined })), /"humanPrompt" must be a non-empty string/);
  });

  it('requires at least one question', () => {
    assert.throws(() => parseFaq(withChanges({ items: [] })), /"items" must be a non-empty list/);
  });

  it('points at the broken item', () => {
    const items = [{ question: 'Q?', answer: 'A.' }, { question: 'No answer' }];
    assert.throws(() => parseFaq(withChanges({ items })), /items\[1\]\.answer must be a non-empty string/);
  });

  it('rejects button labels that are too long', () => {
    assert.throws(() => parseFaq(withChanges({ items: [{ question: 'x'.repeat(65), answer: 'A.' }] })), /items\[0\]\.question is too long/);
  });

  it('reports a missing file with its path', () => {
    assert.throws(() => loadFaq('/nope/faq.json'), /Could not read FAQ file at \/nope\/faq\.json/);
  });
});
