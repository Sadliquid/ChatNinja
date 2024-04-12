require('dotenv/config');
const { Client, IntentsBitField } = require('discord.js');
const { OpenAI } = require('openai');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ],
});

client.on('ready', () => {
    console.log("Joshua's Bot - Status 200 ONLINE")
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_SECRET_KEY })

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;
    if (message.content.startsWith('!')) return;

    let conversationLog = [{ role: 'system', content: "You are a friendly and helpful chatbot."}]

    conversationLog.push({
        role: "user",
        content: message.content
    });

    await message.channel.sendTyping();

    const result = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages: conversationLog
    });

    message.reply(result.choices[0].message);
})

client.login(process.env.DISCORD_TOKEN);