const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { addDays, isBefore, formatDistanceToNow, isAfter } = require('date-fns');
const ldpos = require('ldpos-client');
const cheerio = require('cheerio');
const axios = require('axios');

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
    if (isAfter(new Date(), date)) {
      console.log(`Deleting cooldown client ${key}`);
      delete cooldownClients[key];
    }
  });
}, 10000);

const translations = {
  lsk: 'lisk',
  ark: 'ark',
};

const sendTokens = async (tokenAddress, message, amount = AMOUNT) => {
  try {
    if (
      !ldpos.validateWalletAddress(SYMBOL.toLocaleLowerCase(), tokenAddress)
    ) {
      return message.channel.send(
        `⚠️ Invalid wallet address, try again using a valid format, e.g. \`${SYMBOL.toLocaleLowerCase()}34ffa13f574ab888c5966de86eebf5f7871c5dd0\`.`,
      );
    }

    await ldposClient.connect({ passphrase: PASSPHRASE });

    console.log(`Sending 100${SYMBOL} to client ${tokenAddress}`);

    const preparedTxn = await ldposClient.prepareTransaction({
      type: 'transfer',
      recipientAddress: tokenAddress,
      amount: `${amount}`,
      fee: '10000000',
      timestamp: Date.now(),
      message: `Transaction sent from ${message.author.username} via the Discord faucet.`,
    });

    await ldposClient.postTransaction(preparedTxn);

    cooldownClients[message.author.id] = addDays(new Date(), COOLDOWN_DAYS);
    message.channel.send(
      `🤑 ${parseInt(amount) / 100000000} ${SYMBOL} sent to ${tokenAddress}`,
    );
  } catch (e) {
    console.error(e);
    message.channel.send(`🐛 Error occured \`${e.message}\`.`);
  } finally {
    ldposClient.disconnect();
  }
};

const messageHandler = async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  /**
   * Faucet
   */
  if (message.content.startsWith(`${PREFIX}faucet`)) {
    if (message.channel.name === 'faucet') {
      const parts = message.content.split(' ');
      const tokenAddress = parts[1];

      /**
       * Admin's requesting
       */
      if (message.member.roles.cache.some((r) => r.name === '@core')) {
        if (parts.length === 3) {
          sendTokens(
            tokenAddress,
            message,
            `${parseInt(parts[2] * 100000000)}`,
          );
        } else if (parts.length === 2) {
          sendTokens(tokenAddress, message);
        }

        return;
      }

      /**
       * User's requesting
       */
      if (parts.length > 2) {
        message.channel.send(
          '⚠️ Command only accepts one argument, an address. Please use `!faucet <address>`.',
        );
      } else if (parts.length < 2) {
        message.channel.send(
          '⚠️ Command needs an address. Please use `!faucet <address>`.',
        );
      } else if (isBefore(new Date(), cooldownClients[message.author.id])) {
        message.channel.send(
          `🛑 You're on a cooldown, try again in ${formatDistanceToNow(
            cooldownClients[message.author.id],
            { includeSeconds: true },
          )}.`,
        );
      } else {
        await sendTokens(tokenAddress, message);
      }

      return;
    }
  }

  /**
   * Price
   */

  const symbols = [
    {
      short: 'lsk',
      long: 'lisk',
    },
    {
      short: 'ark',
      long: 'ark',
      inactive: true,
    },
  ];

  if (message.content.startsWith(`${PREFIX}price`)) {
    try {
      let quoteString = '**🚀 Price quotes 🚀**\n\n';

      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i];

        if (s.inactive) {
          quoteString += `💸 **CLSK/${s.short.toLocaleUpperCase()}**: Coming soon!\n`;
          continue;
        }
        // Get our value
        const dexQuote = (
          await axios.get(
            `https://ldex.trading/dex/clsk-${s.short}/api/prices/recent`,
          )
        ).data[0].price;

        // Get external value
        const { data: html } = await axios(
          `https://coinmarketcap.com/currencies/${s.long}`,
        );
        const $ = cheerio.load(html);
        const elementData = $('.priceValue > span')[0].children[0].data;
        const secondQuote = parseFloat(elementData.split('$')[1]);

        console.log(dexQuote, secondQuote);

        quoteString += `💸 **CLSK/${s.short.toLocaleUpperCase()}**: $ ${
          dexQuote * secondQuote
        }\n`;
      }

      message.channel.send(quoteString);
    } catch (e) {
      console.error(e);
      message.channel.send(`🐛 Error occured \`${e.message}\`.`);
    }
  }
};

client.on('messageCreate', messageHandler);

module.export = { messageHandler };
