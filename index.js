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
        console.log("");
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
    if (active && !message.author.bot) {
        if (message.attachments.size > 0 && message.content) {
            const attachment = message.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith("image/")) {
                let longImageUrl = attachment.url;
                console.log("[TEXT]: " + message.content);
                console.log("[IMAGE]: " + longImageUrl.substring(longImageUrl.lastIndexOf('/') + 1, longImageUrl.indexOf('?')));
                console.log("---------------------------------------------------------------");
            } else {
                await message.reply("The attachment must be an image.");
                return;
            }
        } else if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith("image/")) {
                console.log("[IMAGE]: " + attachment.url);
                console.log("---------------------------------------------------------------");
            } else {
                await message.reply("The attachment must be an image.");
                return;
            }
        } else {
            console.log("[TEXT]: " + message.content);
            console.log("---------------------------------------------------------------");
        }
    }
    if (message.author.bot || !active || message.content.startsWith('!')) return;

    await message.channel.sendTyping();

    let imageUrl = null;
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith("image/")) {
            // Get the image URL from the attachment
            imageUrl = attachment.url;
        } else {
            await message.reply("The attachment must be an image.");
            return;
        }
    }

    // Prepare the message content for the conversation log
    const userMessage = { role: "user", content: message.content };
    conversationLog.push(userMessage);

    try {
        let result;
        if (imageUrl) {
            // If there's both text and an image, send both to the API
            result = await openai.chat.completions.create({
                model: 'gpt-4o', // Make sure this is a model that supports multimodal inputs
                messages: [
                    ...conversationLog,
                    {
                        role: "user",
                        content: [
                            { type: "text", text: message.content },
                            { type: "image_url", image_url: { url: imageUrl } }
                        ]
                    }
                ],
                max_tokens: 500
            });
        } else {
            // If there's no image, just send the text message
            result = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: conversationLog,
                max_tokens: 500
            });
        }

        // Reply with the AI's response and add it to the conversation log
        message.reply(result.choices[0].message.content);
        conversationLog.push({ role: 'assistant', content: result.choices[0].message.content });
    } catch (error) {
        console.error("Error from OpenAI API's Servers:", error);

        // Check the type of error and respond accordingly
        if (error.response) {
            // If the error has a response from the API
            await message.reply(`OpenAI API Error: ${error.response.status} - ${error.response.statusText}`);
        } else if (error.request) {
            // If the request was made but no response was received
            await message.reply("No response received from OpenAI API. Please check your internet connection and try again.");
        } else if (error.message.includes("rate limit")) {
            // If the error is related to rate limiting
            await message.reply("The OpenAI API rate limit has been exceeded. Please try again later.");
        } else if (error.message.includes("network")) {
            // If the error is network-related
            await message.reply("A network error occurred. Please check your internet connection and try again.");
        } else {
            // For other types of errors
            await message.reply("An unexpected error occurred. Please try again later.");
        }
    }

    clearTimeout(timeout);
    timeout = setTimeout(() => {
        active = false;
        conversationLog = [
            { role: 'system', content: "You are a friendly and helpful chatbot named ChatNinja." },
            { role: 'system', content: "You should be super casual in all conversations and avoid being formal." }
        ];
        message.channel.send("ChatNinja has left due to recent inactivity. Use `/ninja` to start chatting again!");
    }, 600000);
});

client.login(process.env.DISCORD_TOKEN)