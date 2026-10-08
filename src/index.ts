import path from 'node:path';
import { createBot } from './bot.ts';
import { loadConfig } from './config.ts';
import { loadFaq } from './faq.ts';
import { RelayStore } from './relay-store.ts';

function main(): void {
  const config = loadConfig();
  const faq = loadFaq(config.faqPath);
  const store = new RelayStore({ filePath: path.join(config.dataDir, 'relay-map.json') });
  const bot = createBot({ token: config.botToken, ownerChatId: config.ownerChatId, faq, store });

  console.log(`Loaded ${faq.items.length} FAQ entries from ${config.faqPath}`);
  if (config.ownerChatId === undefined) {
    console.warn('OWNER_CHAT_ID is not set: running in setup mode. Send any message to the bot to get your chat ID.');
  }

  bot
    .launch(async () => {
      console.log(`Bot @${bot.botInfo?.username} is running. Press Ctrl+C to stop.`);
      await bot.telegram
        .setMyCommands([{ command: 'start', description: 'Show the menu' }])
        .catch((err: Error) => console.warn(`Could not set the command list: ${err.message}`));
    })
    .catch((err: Error) => {
      console.error(`Bot stopped: ${err.message}${launchHint(err.message)}`);
      process.exit(1);
    });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

function launchHint(message: string): string {
  if (message.includes('401')) return '\n→ Telegram rejected BOT_TOKEN. Copy it again from @BotFather into .env.';
  if (message.includes('409')) return '\n→ Another copy of this bot is already running with the same token. Stop it first.';
  return '';
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
