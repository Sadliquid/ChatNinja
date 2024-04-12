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

let active = false;

let timeout = null;

client.on('ready', async () => {
    console.log("ChatNinja - Status 200 ONLINE");

    await client.guilds.cache.get(process.env.GUILD_ID)?.commands.set([
        {
            name: 'ninja',
            description: 'Start chatting with ChatNinja!',
        },
        {
            name: 'quit',
            description: 'Quit ChatNinja',
        },
    ]);
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_SECRET_KEY });

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'ninja') {
        if (active) {
            await interaction.reply({ content: "ChatNinja is already active, you can start chatting!", ephemeral: true });
        } else {
            active = true;
            await interaction.reply({ content: "Hey! I'm ChatNinja. Ask me anything to start chatting!", ephemeral: true });
        }
    } else if (interaction.commandName === 'quit') {
        if (!active) {
            await interaction.reply({ content: "ChatNinja has already been quit. You don't need to quit again.", ephemeral: true });
        } else {
            active = false;
            clearTimeout(timeout);
            await interaction.reply({ content: "ChatNinja quit. See you soon!", ephemeral: true });
        }
    }
});

let conversationLog = [{ role: 'system', content: "You are a friendly and helpful chatbot."}]

client.on('messageCreate', async (message) => {
    if (message.author.bot || !active || message.channel.id !== process.env.CHANNEL_ID || message.content.startsWith('!')) return;

    conversationLog.push({
        role: "user",
        content: message.content
    });

    await message.channel.sendTyping();

    const result = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages: conversationLog,
        max_tokens: 75
    });

    message.reply(result.choices[0].message);
    conversationLog.push(result.choices[0].message)

    clearTimeout(timeout);
    timeout = setTimeout(() => {
        active = false;
        message.channel.send("ChatNinja has left due to recent inactivity. Use `/ninja` to start chatting again!");
    }, 600000);
});

client.login(process.env.DISCORD_TOKEN)
