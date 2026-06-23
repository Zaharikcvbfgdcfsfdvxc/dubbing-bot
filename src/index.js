const { initDb } = require('./db/index');

async function main() {
  await initDb();

  const { createBot } = require('./bot/index');
  const { startWeb } = require('./web/index');

  const { bot, startBot } = createBot();
  startWeb(bot);

  if (startBot) {
    startBot();
  } else {
    console.error('Bot token not configured.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
