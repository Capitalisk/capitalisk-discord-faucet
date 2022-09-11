const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { addDays, isBefore, formatDistanceToNow, isAfter } = require('date-fns');
const ldpos = require('ldpos-client');

const {
  DISCORD_TOKEN,
  PASSPHRASE,
  PREFIX,
  AMOUNT,
  SYMBOL,
  COOLDOWN_DAYS,
  CONFIG,
} = require('./config.json');

const ldposClient = ldpos.createClient(CONFIG);

if (!ldposClient.validatePassphrase(PASSPHRASE)) {
  throw Error('Invalid passphrase');
}

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.login(DISCORD_TOKEN);

// Keep track of cooldowns
const cooldownClients = {};

// Remove redundant cooldown clients
setInterval(() => {
  Object.entries(cooldownClients).forEach(([key, date]) => {
    console.log(key, date);
    if (isAfter(date, new Date())) {
      delete cooldownClients[key];
    }
  });
}, 10000);

const messageHandler = async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  if (message.content.startsWith(`${PREFIX}faucet`)) {
    if (message.channel.name === 'faucet') {
      const parts = message.content.split(' ');
      if (parts.length > 2) {
        message.channel.send(
          'Command only accepts one argument, an address. Please use `!faucet <address>`.',
        );
      } else if (parts.length < 2) {
        message.channel.send(
          'Command needs an address. Please use `!faucet <address>`.',
        );
      } else if (isBefore(new Date(), cooldownClients[message.author.id])) {
        message.channel.send(
          `You're on a cooldown, try again in ${formatDistanceToNow(
            cooldownClients[message.author.id],
            { includeSeconds: true },
          )}.`,
        );
      } else {
        const tokenAddress = parts[1];

        if (
          !ldpos.validateWalletAddress(SYMBOL.toLocaleLowerCase(), tokenAddress)
        ) {
          return message.channel.send(
            `Invalid wallet address, try again using a valid format, e.g. \`${SYMBOL.toLocaleLowerCase()}34ffa13f574ab888c5966de86eebf5f7871c5dd0\`.`,
          );
        }

        try {
          await ldposClient.connect({ passphrase: PASSPHRASE });

          const preparedTxn = await ldposClient.prepareTransaction({
            type: 'transfer',
            recipientAddress: tokenAddress,
            amount: '10000000000',
            fee: '10000000',
            timestamp: Date.now(),
            message: `Transaction from ${message.author.username} Discord faucet.`,
          });

          await ldposClient.postTransaction(preparedTxn);

          cooldownClients[message.author.id] = addDays(
            new Date(),
            COOLDOWN_DAYS,
          );
          message.channel.send(`${AMOUNT} ${SYMBOL} sent to ${tokenAddress}`);
        } catch (e) {
          message.channel.send(`Error occured \`${e.message}\`.`);
        } finally {
          ldposClient.disconnect();
        }
      }
    }
  }
};

client.on('messageCreate', messageHandler);

module.export = { messageHandler };
