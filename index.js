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
    console.log("Guild ID: " + client.guilds.cache.first().id)

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

let conversationLog = [{ role: 'system', content: "You are a friendly and helpful chatbot named ChatNinja."}]

client.on('messageCreate', async (message) => {
    console.log("Message: " + message.content)
    if (message.author.bot || !active || message.content.startsWith('!')) return;

    await message.channel.sendTyping();

    let previousMessages = await message.channel.messages.fetch({ limit: 15 });
    previousMessages.reverse();

    previousMessages.forEach((msg) => {
        if (message.content.startsWith('!')) return;
        if (msg.author.id !== client.user.id && message.author.bot) return;
        if (msg.author.id !== message.author.id) return;

        conversationLog.push({
            role: "user",
            content: msg.content,
        })
    });

    const result = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages: conversationLog,
        max_tokens: 75
    });

    message.reply(result.choices[0].message);
    conversationLog.push(result.choices[0].message)

    console.log(conversationLog)

    clearTimeout(timeout);
    timeout = setTimeout(() => {
        active = false;
        message.channel.send("ChatNinja has left due to recent inactivity. Use `/ninja` to start chatting again!");
    }, 60000);
});

client.login(process.env.DISCORD_TOKEN)