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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_SECRET_KEY });

let botActive = false;

client.on('ready', () => {
    console.log("Joshua's Bot - Status 200 ONLINE");
    client.guilds.cache.forEach(guild => {
        guild.commands.create({
            name: 'ninja',
            description: 'Start chatting with ChatNinja!'
        });
        guild.commands.create({
            name: 'quit',
            description: 'Quit ChatNinja'
        });
    });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, channel } = interaction;

    if (commandName === 'ninja') {
        if (!botActive) {
            const filter = (message) => !message.author.bot && message.channel.id === channel.id && !message.content.startsWith('!');
            const collector = channel.createMessageCollector({ filter, time: 600000 });

            collector.on('collect', async (message) => {
                let conversationLog = [{ role: 'system', content: "You are a friendly and helpful chatbot."}];
                conversationLog.push({ role: "user", content: message.content });

                await message.channel.sendTyping();

                const result = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo-0125',
                    messages: conversationLog,
                    max_tokens: 75
                });

                message.reply(result.choices[0].message);
            });

            botActive = true;
            interaction.reply("Hey! I'm ChatNinja. Ask me anything to start chatting!");

            setTimeout(() => {
                if (!botActive) return;
                channel.send("ChatNinja has left due to recent inactivity. Use `/ninja` to start ChatNinja again!");
            }, 600000);
        } else {
            interaction.reply("ChatNinja is already active. You can start chatting!");
        }
    } else if (commandName === 'quit') {
        if (botActive) {
            interaction.reply("You've quit ChatNinja. See you soon!");
            botActive = false;
        } else {
            interaction.reply("ChatNinja is not currently active. You don't need to quit.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
