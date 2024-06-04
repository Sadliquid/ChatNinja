require('dotenv/config');
const { Client, IntentsBitField } = require('discord.js');
const { OpenAI } = require('openai');
const express = require('express');
const app = express();
const port = process.env.PORT;

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
    const guild = client.guilds.cache.first()
    console.log("ChatNinja - Status 200 ONLINE");
    console.log("Guild ID: " + guild.id)
    console.log("Guild name: " + guild.name)

    app.get('/', (req, res) => {
        res.status(200).send("ChatNinja is online!")
    });

    app.listen(port, () => {
        console.log("ChatNinja is listening at http://localhost:" + port);
    })

    await client.guilds.cache.get(guild.id)?.commands.set([
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
            conversationLog = [
                { role: 'system', content: "You are a friendly and helpful chatbot named ChatNinja."},
                { role: 'system', content: "You should be extremely casual in all conversations and avoid being formal."}
            ]
            await interaction.reply({ content: "ChatNinja quit. See you soon!", ephemeral: true });
        }
    }
});

let conversationLog = [
    { role: 'system', content: "You are a friendly and helpful chatbot named ChatNinja."},
    { role: 'system', content: "You should be extremely casual in all conversations and avoid being formal."}
]

client.on('messageCreate', async (message) => {
    if (active && (!message.author.bot)) {
        console.log("User message: " + message.content)
    }
    if (message.author.bot || !active || message.content.startsWith('!')) return;

    await message.channel.sendTyping();

    if (message.content.startsWith('!')) return;

    conversationLog.push({
        role: "user",
        content: message.content,
    })

    try {
        const result = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo-0125',
            messages: conversationLog,
            max_tokens: 500
        });
    
        message.reply(result.choices[0].message);
        conversationLog.push(result.choices[0].message)
    } catch (error) {
        console.error("Error from OpenAI API's Servers:", error);
        message.reply("Server did not respond. Please come back later and try again.");
    }

    clearTimeout(timeout);
    timeout = setTimeout(() => {
        active = false;
        conversationLog = [
            { role: 'system', content: "You are a friendly and helpful chatbot named ChatNinja."},
            { role: 'system', content: "You should be super casual in all conversations and avoid being formal."}
        ]
        message.channel.send("ChatNinja has left due to recent inactivity. Use `/ninja` to start chatting again!");
    }, 600000);
});

client.login(process.env.DISCORD_TOKEN)