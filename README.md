# Telegram Relay & FAQ Bot

A Telegram bot that sits between your customers and you:

- **Instant answers.** `/start` opens a menu of frequently asked questions. Customers tap a question and get the answer right away, any time of day.
- **Talk to a human, privately.** Anything else a customer writes (text, photos, files, voice notes...) is relayed to you. You answer by simply *replying* to it in your own Telegram chat, and the bot delivers your answer to the right customer.
- **Your personal account stays private.** Customers only ever talk to the bot. They never see your name, username or phone number.
- **No code needed to change the FAQ.** Questions and answers live in a plain `faq.json` file.

![Demo](docs/demo.gif)

## How it works

```
Customer ──► Bot ──► You (labelled "📩 Jane Doe (@jane)")
Customer ◄── Bot ◄── You reply to that message
```

1. A customer sends a message to the bot.
2. The bot sends it to your chat, labelled with the customer's name and @username, and confirms receipt to the customer.
3. You *reply* to it (swipe the message on mobile, or right-click → **Reply** on desktop) and type your answer.
4. The bot copies your answer to that customer and adds a 👍 on your message so you know it was delivered.

Several customers can write at the same time: each answer goes to whoever sent the message you replied to. The bot remembers those links in a small file (`data/relay-map.json`), so replies keep working after a restart.

## Quick start (Docker)

You need [Docker](https://docs.docker.com/get-docker/) and a Telegram account.

**1. Create your bot.** Open [@BotFather](https://t.me/BotFather) in Telegram, send `/newbot`, choose a name and a username. BotFather gives you a token like `123456789:AAE...`.

**2. Configure it.**

```bash
cp .env.example .env
```

Open `.env` and paste the token into `BOT_TOKEN=`. Leave `OWNER_CHAT_ID` empty for now.

**3. Find your chat ID.**

```bash
docker compose up -d --build
```

Open your bot in Telegram, press **Start** and send any message. The bot is in *setup mode* and replies with your chat ID. Put it in `.env`:

```
OWNER_CHAT_ID=123456789
```

**4. Restart with the new settings.**

```bash
docker compose up -d --force-recreate
```

That's it. From another Telegram account, open the bot, tap a question or write a message: it shows up in your chat.

Useful commands:

```bash
docker compose logs -f        # see what the bot is doing
docker compose restart        # apply changes to faq.json
docker compose down           # stop it
```

> **Important:** press **Start** on the bot from the owner account at least once. Telegram doesn't let bots message people who never started them.

## Editing the FAQ

Edit `faq.json` and run `docker compose restart`. No rebuild is needed.

```json
{
  "welcome": "👋 Hi! Welcome to Luna Coffee Roasters. ...",
  "humanButton": "💬 Talk to a person",
  "humanPrompt": "Sure! Just type your message here ...",
  "backButton": "⬅️ Back to questions",
  "messageReceived": "✅ Got it! Your message was sent to our team. ...",
  "deliveryFailed": "😕 Sorry, we couldn't deliver your message right now. ...",
  "items": [
    { "question": "🕘 Opening hours", "answer": "We're open Monday to Friday ..." },
    { "question": "🚚 Shipping & delivery", "answer": "We ship nationwide in 2–4 business days ..." }
  ]
}
```

- `items` is the list of buttons, shown in that order. Add, remove or reorder freely.
- `question` is the button label (max 64 characters, emojis welcome). `answer` is the reply (plain text, use `\n` for line breaks).
- The other fields are the fixed texts customers see, so the whole bot can be translated by editing this file.

If the file has a mistake (a missing comma, an empty answer...), the bot refuses to start and the log says exactly where the problem is.

## Using a team group instead of a personal chat

`OWNER_CHAT_ID` can also be a Telegram group: add the bot to the group, send `/id@YourBotUsername` there and use the (negative) number it returns. Customer messages then arrive in the group and anyone in it can answer by replying.

## Running without Docker

Requires Node.js 22.18 or newer (Node runs the TypeScript sources directly, there is no build step).

```bash
npm install
cp .env.example .env   # then fill it in as above
npm start
```

## Tests

The tests cover the FAQ menu, the relay in both directions (including several customers at once and delivery errors), the FAQ file validation and the persistence of the relay map. They use a fake Telegram API, so no token or network connection is needed.

```bash
npm test                               # with Node.js installed
docker compose run --rm bot npm test   # or inside the container
npm run typecheck                      # TypeScript type check
```

## Configuration

| Variable        | Required | Description                                                              |
| --------------- | -------- | ------------------------------------------------------------------------ |
| `BOT_TOKEN`     | yes      | Token from @BotFather.                                                   |
| `OWNER_CHAT_ID` | yes*     | Chat (or group) that receives customer messages. *Empty = setup mode.    |
| `FAQ_PATH`      | no       | Path to the FAQ file. Default: `faq.json`.                               |
| `DATA_DIR`      | no       | Where the relay map is stored. Default: `data` (a Docker volume).        |

## Deploying

The bot uses long polling, so it needs no public URL, domain or open port: any machine that can run Docker works (a small VPS, a home server, a Raspberry Pi...). Copy the project, create `.env` and run `docker compose up -d --build`. The container restarts automatically if it crashes or the machine reboots.

Run only **one** copy per bot token: Telegram delivers each update to a single poller.

## Project structure

```
src/
  index.ts         entry point: loads config, FAQ and starts the bot
  bot.ts           Telegram handlers: FAQ menu and the relay in both directions
  faq.ts           loads and validates faq.json
  relay-store.ts   remembers which owner message belongs to which customer
  config.ts        reads environment variables
test/              unit tests with a fake Telegram API
faq.json           questions, answers and customer-facing texts
```

Built with [Node.js](https://nodejs.org), [TypeScript](https://www.typescriptlang.org) and [Telegraf](https://telegraf.js.org).

## License

MIT
