import path from 'node:path';

export interface Config {
  botToken: string;
  /** Chat that receives customer messages. Undefined = setup mode (the bot only tells people their chat ID). */
  ownerChatId: number | undefined;
  faqPath: string;
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error('BOT_TOKEN is missing. Copy .env.example to .env and paste the token you got from @BotFather.');
  }

  const rawOwner = env.OWNER_CHAT_ID?.trim();
  let ownerChatId: number | undefined;
  if (rawOwner) {
    if (!/^-?\d+$/.test(rawOwner)) {
      throw new Error(`OWNER_CHAT_ID must be a numeric Telegram chat ID, got "${rawOwner}".`);
    }
    ownerChatId = Number(rawOwner);
  }

  return {
    botToken,
    ownerChatId,
    faqPath: path.resolve(env.FAQ_PATH?.trim() || 'faq.json'),
    dataDir: path.resolve(env.DATA_DIR?.trim() || 'data'),
  };
}
