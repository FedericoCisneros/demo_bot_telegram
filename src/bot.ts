import { Markup, Telegraf, type Context, type Telegram } from 'telegraf';
import type { Message, User } from 'telegraf/types';
import type { Faq } from './faq.ts';
import type { RelayStore } from './relay-store.ts';

export interface BotOptions {
  token: string;
  ownerChatId: number | undefined;
  faq: Faq;
  store: RelayStore;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export const CALLBACK_MENU = 'menu';
export const CALLBACK_HUMAN = 'human';
export const CALLBACK_FAQ_PREFIX = 'faq:';

// The "message received" confirmation is sent at most once per customer in this window,
// so someone sending five messages in a row doesn't get five confirmations.
export const ACK_INTERVAL_MS = 30 * 60 * 1000;

const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;

const OWNER_HELP =
  "👋 You're the owner of this bot.\n\n" +
  'Customer messages will show up here. To answer one, reply to it ' +
  '(swipe it, or right-click → Reply) and type your answer: the bot delivers it ' +
  "to the customer, and they never see your personal account.";

export function displayName(user: User): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return user.username ? `${name} (@${user.username})` : name;
}

export function customerHeader(user: User): string {
  return `📩 ${displayName(user)}`;
}

export function menuKeyboard(faq: Faq) {
  return Markup.inlineKeyboard([
    ...faq.items.map((item, i) => [Markup.button.callback(item.question, `${CALLBACK_FAQ_PREFIX}${i}`)]),
    [Markup.button.callback(faq.humanButton, CALLBACK_HUMAN)],
  ]);
}

export function answerKeyboard(faq: Faq) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(faq.backButton, CALLBACK_MENU)],
    [Markup.button.callback(faq.humanButton, CALLBACK_HUMAN)],
  ]);
}

/**
 * Sends a customer's message to the owner chat, labelled with who sent it.
 * Returns the IDs of the messages created in the owner chat (the owner may reply to any of them).
 */
export async function relayToOwner(telegram: Telegram, ownerChatId: number, msg: Message, from: User): Promise<number[]> {
  const header = customerHeader(from);

  if ('text' in msg) {
    const text = `${header}\n\n${msg.text}`;
    if (text.length <= MAX_TEXT_LENGTH) {
      const sent = await telegram.sendMessage(ownerChatId, text);
      return [sent.message_id];
    }
  } else if (hasCaption(msg)) {
    const caption = msg.caption ? `${header}\n\n${msg.caption}` : header;
    if (caption.length <= MAX_CAPTION_LENGTH) {
      const copy = await telegram.copyMessage(ownerChatId, msg.chat.id, msg.message_id, { caption });
      return [copy.message_id];
    }
  }

  // Anything else (stickers, locations, very long texts...): header first, then the
  // original message as a reply to it.
  const sentHeader = await telegram.sendMessage(ownerChatId, header);
  const copy = await telegram.copyMessage(ownerChatId, msg.chat.id, msg.message_id, {
    reply_parameters: { message_id: sentHeader.message_id, allow_sending_without_reply: true },
  });
  return [sentHeader.message_id, copy.message_id];
}

function hasCaption(msg: Message): msg is Message & { caption?: string } {
  return ['photo', 'document', 'video', 'audio', 'voice', 'animation'].some((kind) => kind in msg);
}

/** Returns the command name ("start" for "/start@MyBot payload"), or undefined if the message isn't a command. */
export function commandOf(msg: Message): string | undefined {
  if (!('text' in msg)) return undefined;
  const first = msg.entities?.[0];
  if (first?.type !== 'bot_command' || first.offset !== 0) return undefined;
  return msg.text.slice(1, first.length).split('@')[0]?.toLowerCase();
}

function errorDescription(err: unknown): string {
  const description = (err as { description?: unknown }).description;
  return typeof description === 'string' ? description : (err as Error).message;
}

export function createBot(options: BotOptions): Telegraf {
  const { ownerChatId, faq, store } = options;
  const now = options.now ?? Date.now;
  const lastAckAt = new Map<number, number>();
  const bot = new Telegraf(options.token);

  // Edits the message holding the inline keyboard, so the menu feels like one screen.
  async function showScreen(ctx: Context, text: string, keyboard: ReturnType<typeof menuKeyboard>): Promise<void> {
    try {
      await ctx.editMessageText(text, keyboard);
    } catch (err) {
      if (errorDescription(err).includes('message is not modified')) return; // Same button tapped twice.
      await ctx.reply(text, keyboard);
    }
  }

  bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';

    if (data === CALLBACK_HUMAN) {
      await showScreen(ctx, faq.humanPrompt, Markup.inlineKeyboard([[Markup.button.callback(faq.backButton, CALLBACK_MENU)]]));
      return;
    }
    if (data.startsWith(CALLBACK_FAQ_PREFIX)) {
      const item = faq.items[Number(data.slice(CALLBACK_FAQ_PREFIX.length))];
      // Unknown index = a button from an older faq.json; just show the current menu.
      if (item) {
        await showScreen(ctx, item.answer, answerKeyboard(faq));
        return;
      }
    }
    await showScreen(ctx, faq.welcome, menuKeyboard(faq));
  });

  bot.on('message', async (ctx) => {
    const msg = ctx.message;
    const command = commandOf(msg);

    if (command === 'id') {
      await ctx.reply(`Your chat ID is ${ctx.chat.id}`);
      return;
    }

    if (ownerChatId === undefined) {
      await ctx.reply(
        `🛠 Setup mode: OWNER_CHAT_ID is not set yet.\n\n` +
          `Your chat ID is ${ctx.chat.id}. Put OWNER_CHAT_ID=${ctx.chat.id} in your .env file and restart the bot.`,
      );
      return;
    }

    if (ctx.chat.id === ownerChatId) {
      await handleOwnerMessage(ctx.telegram, msg, command, (text) => ctx.reply(text));
      return;
    }

    // Customers talk to the bot in private; ignore any group it gets added to.
    if (ctx.chat.type !== 'private') return;

    if (command === 'start' || command === 'menu' || command === 'help') {
      await ctx.reply(faq.welcome, menuKeyboard(faq));
      return;
    }

    let ownerMessageIds: number[];
    try {
      ownerMessageIds = await relayToOwner(ctx.telegram, ownerChatId, msg, ctx.from);
    } catch (err) {
      const reason = errorDescription(err);
      const hint = reason.includes("can't initiate conversation") ? ' (open the bot from the owner account and press Start once)' : '';
      console.error(`Could not relay message from chat ${ctx.chat.id} to the owner: ${reason}${hint}`);
      await ctx.reply(faq.deliveryFailed);
      return;
    }
    for (const id of ownerMessageIds) {
      store.link(id, { customerChatId: ctx.chat.id, customerName: displayName(ctx.from) });
    }

    const last = lastAckAt.get(ctx.chat.id);
    if (last === undefined || now() - last >= ACK_INTERVAL_MS) {
      lastAckAt.set(ctx.chat.id, now());
      await ctx.reply(faq.messageReceived);
    }
  });

  async function handleOwnerMessage(
    telegram: Telegram,
    msg: Message,
    command: string | undefined,
    reply: (text: string) => Promise<unknown>,
  ): Promise<void> {
    if (command === 'start' || command === 'help') {
      await reply(OWNER_HELP);
      return;
    }

    const repliedTo = 'reply_to_message' in msg ? msg.reply_to_message : undefined;
    if (!repliedTo) {
      await reply('ℹ️ To answer a customer, reply to their message (swipe it, or right-click → Reply).');
      return;
    }

    const entry = store.lookup(repliedTo.message_id);
    if (!entry) {
      await reply("🤔 I don't know which customer that message belongs to. Reply to a message that starts with 📩.");
      return;
    }

    try {
      // copyMessage (not forward) so the customer sees the bot, never the owner's account.
      await telegram.copyMessage(entry.customerChatId, msg.chat.id, msg.message_id);
    } catch (err) {
      const reason = errorDescription(err);
      const why = reason.includes('blocked by the user') ? 'they blocked the bot' : reason;
      await reply(`⚠️ Could not deliver to ${entry.customerName}: ${why}`);
      return;
    }

    // A quiet 👍 on the owner's message confirms delivery; fall back to text if reactions fail.
    try {
      await telegram.setMessageReaction(msg.chat.id, msg.message_id, [{ type: 'emoji', emoji: '👍' }]);
    } catch {
      await reply(`✅ Sent to ${entry.customerName}`);
    }
  }

  bot.catch((err, ctx) => {
    console.error(`Error while handling update ${ctx.update.update_id}:`, err);
  });

  return bot;
}
