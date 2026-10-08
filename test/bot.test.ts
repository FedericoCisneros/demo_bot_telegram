import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ACK_INTERVAL_MS, CALLBACK_HUMAN, CALLBACK_MENU } from '../src/bot.ts';
import { ALICE, BOB, OWNER_ID, setupBot, telegramError } from './helpers.ts';

afterEach(() => mock.restoreAll());

function buttonLabels(payload: Record<string, any>): string[] {
  return payload.reply_markup.inline_keyboard.flat().map((b: { text: string }) => b.text);
}

describe('FAQ menu', () => {
  it('/start shows the welcome text with one button per question plus "talk to a person"', async () => {
    const t = setupBot();
    await t.text(ALICE, '/start');

    const [sent] = t.callsTo('sendMessage');
    assert.equal(sent!.payload.chat_id, ALICE.id);
    assert.equal(sent!.payload.text, 'Welcome!');
    assert.deepEqual(buttonLabels(sent!.payload), ['Hours?', 'Shipping?', 'Talk to a person']);
    assert.equal(t.store.size, 0, '/start must not be relayed to the owner');
  });

  it('tapping a question shows its answer in place, with back / talk-to-a-person buttons', async () => {
    const t = setupBot();
    await t.tapButton(ALICE, 'faq:1');

    assert.equal(t.callsTo('answerCallbackQuery').length, 1);
    const [edit] = t.callsTo('editMessageText');
    assert.equal(edit!.payload.text, '2-4 days');
    assert.equal(edit!.payload.message_id, 77);
    assert.deepEqual(buttonLabels(edit!.payload), ['Back', 'Talk to a person']);
  });

  it('"back" returns to the menu and "talk to a person" shows the prompt', async () => {
    const t = setupBot();
    await t.tapButton(ALICE, CALLBACK_MENU);
    await t.tapButton(ALICE, CALLBACK_HUMAN);

    const [menu, human] = t.callsTo('editMessageText');
    assert.equal(menu!.payload.text, 'Welcome!');
    assert.equal(human!.payload.text, 'Type your message');
  });

  it('a button from an outdated faq.json falls back to the menu', async () => {
    const t = setupBot();
    await t.tapButton(ALICE, 'faq:99');
    assert.equal(t.callsTo('editMessageText')[0]!.payload.text, 'Welcome!');
  });

  it('tapping the same button twice does not send a duplicate message', async () => {
    const t = setupBot();
    t.respond('editMessageText', () => {
      throw telegramError('Bad Request: message is not modified');
    });
    await t.tapButton(ALICE, 'faq:0');
    assert.equal(t.callsTo('sendMessage').length, 0);
  });

  it('falls back to a new message when the menu message can no longer be edited', async () => {
    const t = setupBot();
    t.respond('editMessageText', () => {
      throw telegramError("Bad Request: message can't be edited");
    });
    await t.tapButton(ALICE, 'faq:0');
    assert.equal(t.callsTo('sendMessage')[0]!.payload.text, 'Mon-Fri 9-18');
  });
});

describe('customer → owner', () => {
  it('relays a text message to the owner, labelled with the customer name and username', async () => {
    const t = setupBot();
    await t.text(ALICE, 'Do you sell decaf?');

    const [relayed, ack] = t.callsTo('sendMessage');
    assert.equal(relayed!.payload.chat_id, OWNER_ID);
    assert.equal(relayed!.payload.text, '📩 Alice Smith (@alice)\n\nDo you sell decaf?');
    assert.equal(ack!.payload.chat_id, ALICE.id);
    assert.equal(ack!.payload.text, 'Message sent');
    assert.equal(t.store.size, 1);
  });

  it('confirms receipt only once per interval, not for every message', async () => {
    let clock = 0;
    const t = setupBot({ now: () => clock });
    await t.text(BOB, 'one');
    await t.text(BOB, 'two');
    clock += ACK_INTERVAL_MS;
    await t.text(BOB, 'three');

    const acks = t.callsTo('sendMessage').filter((c) => c.payload.chat_id === BOB.id);
    assert.equal(acks.length, 2);
  });

  it('relays a photo with its caption, keeping the customer label', async () => {
    const t = setupBot();
    const photo = await t.message(ALICE, { photo: [{ file_id: 'p1', file_unique_id: 'u1', width: 1, height: 1 }], caption: 'Is this one?' });

    const [copy] = t.callsTo('copyMessage');
    assert.equal(copy!.payload.chat_id, OWNER_ID);
    assert.equal(copy!.payload.from_chat_id, ALICE.id);
    assert.equal(copy!.payload.message_id, photo.message_id);
    assert.equal(copy!.payload.caption, '📩 Alice Smith (@alice)\n\nIs this one?');
  });

  it('relays messages without captions (e.g. stickers) as a label followed by the copied message', async () => {
    const t = setupBot();
    await t.message(BOB, { sticker: { file_id: 's1', file_unique_id: 'u1', width: 1, height: 1, is_animated: false, is_video: false, type: 'regular' } });

    const [header] = t.callsTo('sendMessage');
    const [copy] = t.callsTo('copyMessage');
    assert.equal(header!.payload.text, '📩 Bob');
    assert.equal(copy!.payload.reply_parameters.message_id, 500);
    assert.equal(t.store.size, 2, 'the owner can reply to either message');
  });

  it('tells the customer when the message could not be delivered to the owner', async () => {
    const t = setupBot();
    mock.method(console, 'error', () => {});
    t.respond('sendMessage', (payload) => {
      if (payload.chat_id === OWNER_ID) throw telegramError("Forbidden: bot can't initiate conversation with a user");
      return { message_id: 1, date: 0, chat: { id: payload.chat_id, type: 'private' } };
    });
    await t.text(ALICE, 'hello?');

    const toAlice = t.callsTo('sendMessage').filter((c) => c.payload.chat_id === ALICE.id);
    assert.deepEqual(toAlice.map((c) => c.payload.text), ['Could not send']);
    assert.equal(t.store.size, 0);
  });

  it('ignores messages in groups the bot was added to', async () => {
    const t = setupBot();
    await t.message(ALICE, { text: 'hi group' }, -555, 'group');
    assert.equal(t.calls.length, 0);
  });
});

describe('owner → customer', () => {
  it('routes each owner reply to the right customer, without revealing the owner', async () => {
    const t = setupBot();
    await t.text(ALICE, 'question from Alice'); // relayed to the owner as message 500 (ack is 501)
    await t.text(BOB, 'question from Bob'); // relayed as 502
    t.clearCalls();

    const answer = await t.ownerReply(500, 'Yes, we do!');

    const [copy] = t.callsTo('copyMessage');
    assert.equal(copy!.payload.chat_id, ALICE.id);
    assert.equal(copy!.payload.from_chat_id, OWNER_ID);
    assert.equal(copy!.payload.message_id, answer.message_id);
    assert.equal(t.callsTo('forwardMessage').length, 0, 'forwarding would expose the owner account');

    const [reaction] = t.callsTo('setMessageReaction');
    assert.equal(reaction!.payload.chat_id, OWNER_ID);
    assert.equal(reaction!.payload.message_id, answer.message_id);
  });

  it('routes a reply to the second customer to that customer', async () => {
    const t = setupBot();
    await t.text(ALICE, 'from Alice'); // relayed as 500
    await t.text(BOB, 'from Bob'); // relayed as 502
    t.clearCalls();

    await t.ownerReply(502, 'Hi Bob');
    assert.equal(t.callsTo('copyMessage')[0]!.payload.chat_id, BOB.id);
  });

  it('confirms with a text message when reactions are not available', async () => {
    const t = setupBot();
    await t.text(ALICE, 'hi');
    t.respond('setMessageReaction', () => {
      throw telegramError('Bad Request: REACTION_INVALID');
    });
    t.clearCalls();
    await t.ownerReply(500, 'hello');

    const [confirmation] = t.callsTo('sendMessage');
    assert.equal(confirmation!.payload.chat_id, OWNER_ID);
    assert.equal(confirmation!.payload.text, '✅ Sent to Alice Smith (@alice)');
  });

  it('tells the owner when the customer blocked the bot', async () => {
    const t = setupBot();
    await t.text(ALICE, 'hi');
    t.respond('copyMessage', () => {
      throw telegramError('Forbidden: bot was blocked by the user');
    });
    t.clearCalls();
    await t.ownerReply(500, 'hello');

    const [notice] = t.callsTo('sendMessage');
    assert.equal(notice!.payload.text, '⚠️ Could not deliver to Alice Smith (@alice): they blocked the bot');
  });

  it('explains how to answer when the owner writes without replying', async () => {
    const t = setupBot();
    await t.text({ id: OWNER_ID, is_bot: false, first_name: 'Owner' }, 'hello?');

    assert.equal(t.callsTo('copyMessage').length, 0);
    assert.match(t.callsTo('sendMessage')[0]!.payload.text, /reply to their message/);
  });

  it('does not guess when the owner replies to a message that is not from a customer', async () => {
    const t = setupBot();
    await t.ownerReply(12345, 'who is this for?');

    assert.equal(t.callsTo('copyMessage').length, 0);
    assert.match(t.callsTo('sendMessage')[0]!.payload.text, /don't know which customer/);
  });

  it('works when OWNER_CHAT_ID is a team group, even if a member also writes to the bot as a customer', async () => {
    const GROUP = -100500;
    const t = setupBot({ ownerChatId: GROUP });
    await t.text(ALICE, 'hi from private'); // relayed to the group as 500
    t.clearCalls();

    const reply = await t.message(ALICE, {
      text: 'answer from the team',
      reply_to_message: { message_id: 500, date: 0, chat: { id: GROUP, type: 'supergroup' }, text: 'quoted' },
    }, GROUP, 'supergroup');

    const [copy] = t.callsTo('copyMessage');
    assert.equal(copy!.payload.chat_id, ALICE.id);
    assert.equal(copy!.payload.from_chat_id, GROUP);
    assert.equal(copy!.payload.message_id, reply.message_id);
  });

  it('shows the owner instructions on /start instead of the customer menu', async () => {
    const t = setupBot();
    await t.text({ id: OWNER_ID, is_bot: false, first_name: 'Owner' }, '/start');
    assert.match(t.callsTo('sendMessage')[0]!.payload.text, /You're the owner/);
  });
});

describe('setup helpers', () => {
  it('without OWNER_CHAT_ID, tells whoever writes their chat ID', async () => {
    const t = setupBot({ ownerChatId: null });
    await t.text(ALICE, 'hi');

    const [reply] = t.callsTo('sendMessage');
    assert.equal(reply!.payload.chat_id, ALICE.id);
    assert.match(reply!.payload.text, /OWNER_CHAT_ID=2001/);
  });

  it('/id replies with the chat ID', async () => {
    const t = setupBot();
    await t.text(BOB, '/id');
    assert.equal(t.callsTo('sendMessage')[0]!.payload.text, `Your chat ID is ${BOB.id}`);
  });
});
