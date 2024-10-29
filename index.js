require('dotenv/config');
const { Client, IntentsBitField } = require('discord.js');
const { OpenAI } = require('openai');
const firebase = require('firebase-admin');
const express = require('express');
const app = express();
const port = process.env.PORT;

firebase.initializeApp({
    credential: firebase.credential.cert(require('./serviceAccountKeyCN.json')),
    databaseURL: process.env.DB_URL
});

const db = firebase.database();

const bot = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ],
});

bot.once('ready', async () => {
    console.log(`Logged in as ${bot.user.tag}!`);

    // Initialize guild data and set commands in Firebase on bot startup
    bot.guilds.cache.forEach(async (guild) => {
        await db.ref(`guilds/${guild.id}`).set({
            guildName: guild.name
        });

        // Set commands for each guild
        await guild.commands.set([
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

    app.get('/', (req, res) => {
        res.status(200).send("ChatNinja is online!");
    });

    app.listen(port, () => {
        console.log("ChatNinja is listening at http://localhost:" + port);
        console.log("");
    });
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_SECRET_KEY });

bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const command = interaction.commandName;

    const userRef = db.ref(`guilds/${guildId}/users/${userId}`);

    // Ensure user data exists
    const userSnapshot = await userRef.once('value');
    if (!userSnapshot.exists()) {
        await userRef.set({
            username,
            session: { isActive: false, isProcessing: false, conversationHistory: [] }
        });
    }

    const sessionSnapshot = await userRef.child('session').once('value');
    let session = sessionSnapshot.val();

    if (session === null) {
        session = {
            isActive: false,
            isProcessing: false,
            conversationHistory: []
        };
        await userRef.child('session').set(session);
    }

    if (command === 'ninja') {
        if (session.isActive) {
            await interaction.reply({ content: 'You already have an active session! Start chatting', ephemeral: true });
            return;
        }

        await userRef.child('session').update({ isActive: true });
        interaction.reply({ content: `Session started for ${username}! Type your message to chat.`, ephemeral: true });
    } else if (command === 'quit') {
        await userRef.child('session').update({ isActive: false, isProcessing: false });
        interaction.reply({ content: 'Your session has ended!', ephemeral: true });
    }
});

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const guildId = message.guild.id;
    const userId = message.author.id;
    const userRef = db.ref(`guilds/${guildId}/users/${userId}`);

    userRef.child('session').once('value', async (snapshot) => {
        const session = snapshot.val();

        if (!session.isActive) {
            message.reply({ content: 'Please use the /ninja command to start a session.', ephemeral: true });
            return;
        }

        if (session.isProcessing) {
            message.reply({ content: 'Please wait for ChatNinja to respond to previous messages.', ephemeral: true });
            return;
        }

        // Set isProcessing flag
        await userRef.child('session').update({ isProcessing: true });

        try {
            let imageUrls = [];
            if (message.attachments.size > 0) {
                if (message.attachments.size > 3) {
                    await message.reply({ content: "You can only upload a max of 3 images per message.", ephemeral: true });
                    return;
                }

                message.attachments.forEach((attachment) => {
                    if (attachment.contentType && attachment.contentType.startsWith("image/")) {
                        imageUrls.push(attachment.url);
                    } else {
                        message.reply("Sorry, all attachments must be images.");
                        return;
                    }
                });
            }

            if (message.content.startsWith('!')) return;

            await message.channel.sendTyping();

            const conversationLog = session.conversationHistory || [];
            const userMessage = { role: "user", content: message.content };
            conversationLog.push(userMessage);

            try {
                let result;
                if (imageUrls.length > 0) {
                    // If there are images, send them to the API
                    result = await openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [
                            ...conversationLog,
                            {
                                role: "user",
                                content: imageUrls.map(url => ({ type: "image_url", image_url: { url } }))
                            }
                        ],
                        max_tokens: 750
                    });
                } else {
                    // If there's no image, just send the text message
                    result = await openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: conversationLog,
                        max_tokens: 600
                    });
                }

                const assistantReply = result.choices[0].message.content;
                message.reply(assistantReply);
                conversationLog.push({ role: 'assistant', content: assistantReply });
                await userRef.child('session/conversationHistory').set(conversationLog);
            } catch (error) {
                console.error("Error from OpenAI API's Servers:", error);
                // Handle errors here
            }
        } catch (error) {
            console.error("Error from ChatNinja's Server:", error);
            message.reply('Something went wrong. Please try again later.');
        } finally {
            await userRef.child('session').update({ isProcessing: false });
        }
    });
});

bot.login(process.env.DISCORD_TOKEN)