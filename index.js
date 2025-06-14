require('dotenv/config');
const { Client, IntentsBitField, PermissionsBitField, ChannelType } = require('discord.js');
const { OpenAI } = require('openai');
const firebase = require('firebase-admin');
const express = require('express');
const app = express();
const port = process.env.PORT;

const db = firebase.initializeApp({
    credential: firebase.credential.cert(require('./serviceAccountKeyCN.json')),
    databaseURL: process.env.DB_URL
}, 'db').database();

const CS_DB = firebase.initializeApp({
    credential: firebase.credential.cert(require('./CS_ServiceAccountKey.json')),
    databaseURL: process.env.CS_DB_URL
}, 'CS_DB').database();

const bot = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ],
});

bot.once('ready', async () => {
    bot.guilds.cache.forEach(async (guild) => {
        await db.ref(`guilds/${guild.id}`).set({
            guildName: guild.name
        });

        await guild.commands.set([
            {
                name: 'ninja',
                description: 'Start chatting with ChatNinja!',
            },
            {
                name: 'end',
                description: 'End chat session',
            },
            {
                name: 'config',
                description: 'Activate ChatNinja',
            }
        ]);
    });

    app.get('/', (req, res) => {
        res.status(200).send("Welcome to the ChatNinja Backend Server!");
    });

    app.listen(port, () => {
        console.log("ChatNinja is running on http://localhost:" + port);
        console.log("");
    });
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_SECRET_KEY });

bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.channel.name !== 'chatninja') {
        await interaction.reply({ content: 'Please use ChatNinja in a `#chatninja` channel, or create one!', ephemeral: true });
        return;
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const command = interaction.commandName;

    const serviceSnapshot = await CS_DB.ref(`services/Chatninja`).once('value');
    const serviceStatus = serviceSnapshot.val();

    if (!serviceStatus) {
        if (interaction.user.id !== bot.user.id) {
            await interaction.reply({ content: 'ChatNinja has been disabled. Please try again later.', ephemeral: true });
        }
        return;
    }

    const userRef = db.ref(`guilds/${guildId}/users/${userId}`);

    const userSnapshot = await userRef.once('value');
    if (!userSnapshot.exists()) {
        await userRef.set({
            username,
            session: { isActive: false, isProcessing: false, mode: "unactivated", configuring: false, apiKey: "default", trialPrompts: 5, conversationHistory: [] }
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
        if (session.mode === "unactivated") {
            await interaction.reply({ content: 'Please use the `/config` command to activate ChatNinja first.', ephemeral: true });
            return;
        }
        if (session.isActive) {
            await interaction.reply({ content: 'You already have an active session! Start chatting.', ephemeral: true });
            return;
        }

        await userRef.child('session').update({ isActive: true });
        interaction.reply({ content: `Session active for ${username}! Send a message to start chatting.`, ephemeral: true });
    } else if (command === 'end') {
        if (session.mode === "unactivated") {
            await interaction.reply({ content: 'Please use the `/config` command to activate ChatNinja first.', ephemeral: true });
            return;
        }
        await userRef.child('session').update({ isActive: false, isProcessing: false });
        interaction.reply({ content: 'Your session has ended!', ephemeral: true });
    } else if (command === 'config') {
        if (session.mode === "overrideMode") {
            await interaction.reply({ content: 'You already have unrestricted access to ChatNinja. Start chatting!', ephemeral: true });
            return;
        }

        await userRef.child('session').update({ configuring: true });
        await interaction.reply({ content: 'Please select a mode to activate ChatNinja:\n\n1.) Trial mode (5 trial prompts).\n\n2.) Provide your own OpenAI API Key.\n\n3.) Override access with an access key.\n\nPlease choose 1, 2 or 3.', ephemeral: true });
        const filter = m => m.author.id === interaction.user.id;
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first().content;
            if (response === "1") {
                if (session.trialPrompts === 0) {
                    await interaction.editReply({ content: 'You have used up your free trial. Please provide your own OpenAI API Key or use an Access Key to override access.', ephemeral: true });
                    await userRef.child('session').update({ configuring: false });
                    return;
                }
                await interaction.editReply({ content: 'Trial mode activated! You have 5 trial prompts.', ephemeral: true });
                await userRef.child('session').update({ mode: "trialMode", configuring: false });
            } else if (response === "2") {
                await interaction.editReply({ content: 'Please enter your OpenAI API Key:', ephemeral: true });
                const apiKeyFilter = m => m.author.id === interaction.user.id;
                const apiKeyCollected = await interaction.channel.awaitMessages({ apiKeyFilter, max: 1, time: 60000, errors: ['time'] });
                const apiKeyResponse = apiKeyCollected.first().content;

                const test_openai = new OpenAI({ apiKey: apiKeyResponse });

                try {
                    const result = await test_openai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: "user",
                                content: "How many days are there in a week?"
                            }
                        ],
                        max_tokens: 50
                    });

                    const assistantReply = result.choices[0].message.content;
                    if (assistantReply) {
                        await interaction.editReply({ content: 'Your API Key has been verified and activated!', ephemeral: true });
                        await userRef.child('session').update({ apiKey: apiKeyResponse, mode: "apiKeyMode", configuring: false });
                    }
                }
                catch (error) {
                    await interaction.editReply({ content: 'Invalid API Key. Please try again.', ephemeral: true });
                    await userRef.child('session').update({ configuring: false });
                }
            } else if (response === "3") {
                await interaction.editReply({ content: 'Please send your access key in your next message.', ephemeral: true });
                const accessKeyFilter = m => m.author.id === interaction.user.id;
                const accessKeyCollected = await interaction.channel.awaitMessages({ accessKeyFilter, max: 1, time: 60000, errors: ['time'] });
                const accessKeyResponse = accessKeyCollected.first().content;

                const accessKeysRef = db.ref('accessKeys');
                const accessKeysSnapshot = await accessKeysRef.once('value');
                const accessKeys = accessKeysSnapshot.val();

                if (accessKeys === null || accessKeys[String(accessKeyResponse)] !== "key") {
                    await interaction.editReply({ content: 'Invalid access key. Please try again.', ephemeral: true });
                    await userRef.child('session').update({ configuring: false });
                    return;
                }

                await accessKeysRef.child(accessKeyResponse).remove();
                const accessKey = require('uuid').v4();
                await accessKeysRef.child(accessKey).set("key");
                await interaction.editReply({ content: 'Verification succeeded - Welcome back.', ephemeral: true });
                await userRef.child('session').update({ mode: "overrideMode", configuring: false });

            } else {
                await interaction.editReply({ content: 'Please choose an option from 1 to 3.', ephemeral: true });
                await userRef.child('session').update({ configuring: false });
            }
        } catch (error) {
            await interaction.editReply({ content: "Sorry, ChatNinja didn't receive a response. Please try again.", ephemeral: true });
            await userRef.child('session').update({ configuring: false });
        }
    } else {
        await interaction.editReply({ content: 'Invalid command. Please use the `/ninja` command to start a session.', ephemeral: true });
        await userRef.child('session').update({ configuring: false });
    }
});

bot.on('guildCreate', async (guild) => {
    const existingChannel = guild.channels.cache.find(channel => channel.name === 'chatninja');

    if (!existingChannel) {
        try {
            await guild.channels.create({
                name: 'chatninja',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        allow: [PermissionsBitField.Flags.ViewChannel],
                    },
                ],
            });
        } catch (error) {
            console.error(`Error creating #chatninja channel for Guild with GuildID: ${guild.id}`, error);
        }
    }
});

bot.on('messageCreate', async (message) => {
    if (process.env.DISABLE_API_KEY === "true") {
        if (message.author.id !== bot.user.id) {
            await message.reply({ content: 'The ChatNinja API has been disabled. Please try again later.', ephemeral: true });
        }
        return;
    }
    if (message.author.bot) return;

    if (message.channel.name !== 'chatninja') {
        return;
    }

    const guildId = message.guild.id;
    const userId = message.author.id;
    const userRef = db.ref(`guilds/${guildId}/users/${userId}`);

    userRef.child('session').once('value', async (snapshot) => {
        let session = snapshot.val();

        if (session === null) {
            session = {
                isActive: false,
                isProcessing: false,
                conversationHistory: []
            };
            await userRef.child('session').set(session);
        }

        if (session.configuring === true) return;

        if (session.mode === "unactivated") return;

        if (!session.isActive) {
            message.reply({ content: "Please use the `/ninja` command to start a session, or the `/config` command to activate ChatNinja.", ephemeral: true });
            return;
        }

        if (session.mode === "trialMode" && session.trialPrompts === 0) {
            message.reply({ content: "You have exhausted your trial prompts. Please use the `/config` command to activate ChatNinja.", ephemeral: true });
            return;
        }

        let user_openai = null
        if (session.mode === "apiKeyMode" && session.apiKey !== "default") {
            user_openai = new OpenAI({ apiKey: session.apiKey });
        }

        const model = ((user_openai !== null) && (session.mode !== "overrideMode")) ? user_openai : openai;

        if (session.isProcessing) {
            message.reply({ content: 'Please wait for ChatNinja to respond to previous messages first.', ephemeral: true });
            return;
        }

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
                        message.reply("Sorry, all attachments must be in valid image format.");
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
                const maxLength = 1997;
                if (imageUrls.length > 0) {
                    result = await model.chat.completions.create({
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
                    result = await model.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: conversationLog,
                        max_tokens: 600
                    });
                }

                const assistantReply = result.choices[0].message.content;
                if (assistantReply.length > maxLength) {
                    const chunks = [];
                    for (let i = 0; i < assistantReply.length; i += maxLength) {
                        chunks.push(assistantReply.substring(i, i + maxLength));
                    }

                    await message.reply(chunks[0] + "...");

                    const remainingChunks = chunks.slice(1).map(chunk => `...${chunk}`).join('');

                    await message.reply("The response was too long to send all at once. Here's more:\n\n" + remainingChunks);
                } else {
                    message.reply(assistantReply);
                    if (session.mode === "trialMode") {
                        await userRef.child('session').update({ trialPrompts: session.trialPrompts - 1 });
                    }
                    conversationLog.push({ role: 'assistant', content: assistantReply });
                    await userRef.child('session/conversationHistory').set(conversationLog);
                }
            } catch (error) {
                message.reply("Something went wrong in OpenAI's Servers. Please try again later.");
                console.log(error);
            }
        } catch (error) {
            message.reply("Something went wrong in ChatNinja's Servers. Please try again later.");
            console.log(error);
        } finally {
            await userRef.child('session').update({ isProcessing: false });
        }
    });
});

bot.login(process.env.DISCORD_TOKEN)