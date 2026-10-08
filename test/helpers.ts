import { mock } from 'node:test';
import { Telegram, type Telegraf } from 'telegraf';
import type { Update, User, UserFromGetMe } from 'telegraf/types';
import { createBot } from '../src/bot.ts';
import { parseFaq, type Faq } from '../src/faq.ts';
import { RelayStore } from '../src/relay-store.ts';

export const OWNER_ID = 1000;
export const ALICE: User = { id: 2001, is_bot: false, first_name: 'Alice', last_name: 'Smith', username: 'alice' };
export const BOB: User = { id: 2002, is_bot: false, first_name: 'Bob' };

export const TEST_FAQ: Faq = parseFaq(
  JSON.stringify({
    welcome: 'Welcome!',
    humanButton: 'Talk to a person',
    humanPrompt: 'Type your message',
    backButton: 'Back',
    messageReceived: 'Message sent',
    deliveryFailed: 'Could not send',
    items: [
      { question: 'Hours?', answer: 'Mon-Fri 9-18' },
      { question: 'Shipping?', answer: '2-4 days' },
    ],
  }),
);

export interface ApiCall {
  method: string;
  payload: Record<string, any>;
}

type Responder = (payload: Record<string, any>) => unknown;

/** Error shaped like the ones Telegraf throws for Bot API failures. */
export function telegramError(description: string): Error {
  return Object.assign(new Error(description), { description });
}

/**
 * Builds a bot whose Telegram API calls are intercepted: nothing reaches the network.
 * Every call is recorded in `calls`; `respond` lets a test override a method's result or make it throw.
 */
export function setupBot(options: { ownerChatId?: number | null; now?: () => number } = {}) {
  const calls: ApiCall[] = [];
  const responders = new Map<string, Responder>();
  let nextMessageId = 500;

  mock.method(Telegram.prototype, 'callApi', async (method: string, payload: Record<string, any>) => {
    calls.push({ method, payload });
    const responder = responders.get(method);
    if (responder) return responder(payload);
    switch (method) {
      case 'sendMessage':
        return { message_id: nextMessageId++, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
      case 'copyMessage':
        return { message_id: nextMessageId++ };
      default:
        return true;
    }
  });

  const store = new RelayStore();
  const ownerChatId = options.ownerChatId === null ? undefined : (options.ownerChatId ?? OWNER_ID);
  const bot: Telegraf = createBot({ token: 'TEST:TOKEN', ownerChatId, faq: TEST_FAQ, store, now: options.now });
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Demo', username: 'demo_bot' } as UserFromGetMe;

  let updateId = 1;
  let incomingMessageId = 1;

  async function send(update: Omit<Update, 'update_id'>): Promise<void> {
    await bot.handleUpdate({ update_id: updateId++, ...update } as Update);
  }

  /** A message arriving from `from` in their private chat (or in `chatId` if given). */
  function message(from: User, content: Record<string, unknown>, chatId = from.id, chatType = 'private') {
    const msg = { message_id: incomingMessageId++, date: 0, from, chat: { id: chatId, type: chatType }, ...content };
    return send({ message: msg } as any).then(() => msg);
  }

  function text(from: User, body: string, extra: Record<string, unknown> = {}) {
    const entities = body.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: body.split(' ')[0]!.length }] : undefined;
    return message(from, { text: body, ...(entities && { entities }), ...extra });
  }

  /** The owner replying, in their own chat, to message `replyToId`. */
  function ownerReply(replyToId: number, body: string) {
    const owner: User = { id: OWNER_ID, is_bot: false, first_name: 'Owner' };
    return text(owner, body, {
      reply_to_message: { message_id: replyToId, date: 0, chat: { id: OWNER_ID, type: 'private' }, text: 'quoted' },
    });
  }

  function tapButton(from: User, data: string) {
    return send({
      callback_query: {
        id: `cb${updateId}`,
        from,
        chat_instance: 'x',
        data,
        message: { message_id: 77, date: 0, chat: { id: from.id, type: 'private' }, text: 'menu' },
      },
    } as any);
  }

  return {
    bot,
    store,
    calls,
    respond: (method: string, responder: Responder) => responders.set(method, responder),
    callsTo: (method: string) => calls.filter((c) => c.method === method),
    clearCalls: () => calls.splice(0),
    message,
    text,
    ownerReply,
    tapButton,
  };
}
