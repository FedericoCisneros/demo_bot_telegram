import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('reads the token, owner chat ID and default paths', () => {
    const config = loadConfig({ BOT_TOKEN: ' 123:abc ', OWNER_CHAT_ID: '987654' });
    assert.equal(config.botToken, '123:abc');
    assert.equal(config.ownerChatId, 987654);
    assert.equal(config.faqPath, path.resolve('faq.json'));
    assert.equal(config.dataDir, path.resolve('data'));
  });

  it('accepts negative IDs (group chats)', () => {
    assert.equal(loadConfig({ BOT_TOKEN: 't', OWNER_CHAT_ID: '-100123' }).ownerChatId, -100123);
  });

  it('leaves the owner unset when OWNER_CHAT_ID is empty (setup mode)', () => {
    assert.equal(loadConfig({ BOT_TOKEN: 't', OWNER_CHAT_ID: '' }).ownerChatId, undefined);
  });

  it('fails clearly without a token', () => {
    assert.throws(() => loadConfig({}), /BOT_TOKEN is missing/);
  });

  it('rejects an owner ID that is not a number', () => {
    assert.throws(() => loadConfig({ BOT_TOKEN: 't', OWNER_CHAT_ID: '@fede' }), /OWNER_CHAT_ID must be a numeric/);
  });
});
