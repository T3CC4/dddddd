const { Client, GatewayIntentBits, Collection, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const CONFIG = require('./config.js');

// Import centralized bot utilities
const {
    initialize,
    messageLogger,
    avatarManager,
    userManager,
    embedBuilder,
    buttonBuilder,
    modalBuilder,
    commandProcessor,
    ticketManager,
    tempChannelManager
} = require('./utils/bot');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ]
});

const db = new sqlite3.Database('./bot_database.sqlite');

// Initialize database tables
db.serialize(() => {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            verification_code TEXT,
            verified BOOLEAN DEFAULT 0,
            joined_at DATETIME,
            personal_channel_id TEXT,
            avatar_hash TEXT,
            discriminator TEXT,
            last_seen DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS message_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            user_id TEXT,
            username TEXT,
            channel_id TEXT,
            channel_name TEXT,
            content TEXT,
            attachments TEXT,
            timestamp DATETIME,
            edited BOOLEAN DEFAULT 0,
            deleted BOOLEAN DEFAULT 0,
            user_avatar_hash TEXT,
            user_discriminator TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id TEXT UNIQUE,
            user_id TEXT,
            channel_id TEXT,
            status TEXT DEFAULT 'open',
            created_at DATETIME,
            closed_at DATETIME,
            transcript TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS temp_channels (
            channel_id TEXT PRIMARY KEY,
            owner_id TEXT,
            created_at DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS web_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT,
            unique_password TEXT,
            created_at DATETIME,
            last_login DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS web_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            details TEXT,
            timestamp DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER,
            device_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
        )`,
        `CREATE TABLE IF NOT EXISTS bot_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            command_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            parameters TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            executed_at DATETIME,
            result TEXT,
            retry_count INTEGER DEFAULT 0,
            last_error TEXT
        )`
    ];

    tables.forEach(sql => db.run(sql));
});

// Initialize bot utilities
initialize(client, db, CONFIG);

/**
 * Event Handler Registration
 */
const eventHandlers = {
    'ready': async () => {
        console.log(`🤖 14th Squad Bot ist online als ${client.user.tag}!`);
        console.log(`📡 Verbunden mit Server: ${client.guilds.cache.first()?.name}`);
        console.log(`👥 Server-Mitglieder: ${client.guilds.cache.first()?.memberCount}`);

        // Start command processor
        commandProcessor.startProcessor();

        // Start avatar sync
        setTimeout(() => {
            avatarManager.bulkSync();
        }, 30000);

        // Schedule regular avatar sync
        setInterval(() => {
            avatarManager.bulkSync();
        }, 6 * 60 * 60 * 1000);

        client.user.setActivity('14th Squad Management', { type: 'WATCHING' });

        // Register slash commands
        await registerSlashCommands();
    },

    'guildMemberAdd': async (member) => {
        const result = await userManager.createUser(member);
        if (!result.success) {
            console.error('❌ Fehler bei Benutzer-Beitritt:', result.error);
        }
    },

    'voiceStateUpdate': async (oldState, newState) => {
        try {
            // User joins "Join to Create" channel
            if (newState.channelId === CONFIG.JOIN_TO_CREATE_CHANNEL) {
                const result = await tempChannelManager.create(newState.member);
                if (!result.success) {
                    console.error('❌ Fehler bei Temp Channel Erstellung:', result.error);
                }
            }

            // User leaves temp channel - delete if empty
            if (oldState.channel && tempChannelManager.channels.has(oldState.channelId)) {
                await tempChannelManager.delete(oldState.channelId);
            }
        } catch (error) {
            console.error('❌ Fehler bei Voice State Update:', error);
        }
    },

    'messageCreate': (message) => messageLogger.handleMessage(message, false, false),
    'messageUpdate': (oldMessage, newMessage) => messageLogger.handleMessage(newMessage, true, false),
    'messageDelete': (message) => messageLogger.handleMessage(message, false, true),

    'interactionCreate': async (interaction) => {
        try {
            if (interaction.isButton()) {
                await handleButtonInteraction(interaction);
            } else if (interaction.isModalSubmit()) {
                await handleModalInteraction(interaction);
            } else if (interaction.isChatInputCommand()) {
                await handleSlashCommand(interaction);
            }
        } catch (error) {
            console.error('❌ Fehler bei Interaction:', error);
            
            const errorMessage = '❌ Ein Fehler ist aufgetreten!';
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: errorMessage });
                }
            } catch (replyError) {
                console.error('❌ Fehler beim Senden der Fehlerantwort:', replyError);
            }
        }
    }
};

// Register all event handlers
Object.entries(eventHandlers).forEach(([event, handler]) => {
    client.on(event, handler);
});

/**
 * Button Interaction Handler
 */
async function handleButtonInteraction(interaction) {
    const { customId } = interaction;

    if (customId.startsWith('voice_')) {
        await handleVoiceControlButton(interaction);
    } else if (customId === 'close_ticket') {
        await handleTicketCloseButton(interaction);
    }
}

/**
 * Voice Control Button Handler
 */
async function handleVoiceControlButton(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const channelId = parts[2];

    const channel = interaction.guild.channels.cache.get(channelId);

    if (!channel || !tempChannelManager.channels.has(channelId)) {
        return interaction.reply({ 
            content: '❌ Channel nicht gefunden oder nicht berechtigt!', 
            flags: MessageFlags.Ephemeral 
        });
    }

    const channelData = tempChannelManager.channels.get(channelId);
    if (channelData.owner !== interaction.user.id) {
        return interaction.reply({ 
            content: '❌ Nur der Channel-Owner kann diese Aktion ausführen!', 
            flags: MessageFlags.Ephemeral 
        });
    }

    const voiceActions = {
        'lock': async () => {
            await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
            return '🔒 Voice Channel wurde gesperrt!';
        },
        'unlock': async () => {
            await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: null });
            return '🔓 Voice Channel wurde entsperrt!';
        },
        'invisible': async () => {
            await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
            return '👻 Voice Channel ist jetzt unsichtbar!';
        },
        'limit': async () => {
            const modal = modalBuilder.createVoiceLimit(channelId, channel.userLimit);
            await interaction.showModal(modal);
            return null; // No immediate reply for modals
        },
        'rename': async () => {
            const modal = modalBuilder.createVoiceRename(channelId, channel.name);
            await interaction.showModal(modal);
            return null; // No immediate reply for modals
        },
        'delete': async () => {
            await channel.delete();
            tempChannelManager.channels.delete(channelId);
            db.run(`DELETE FROM temp_channels WHERE channel_id = ?`, [channelId]);
            return '🗑️ Voice Channel wurde gelöscht!';
        }
    };

    const actionHandler = voiceActions[action];
    if (actionHandler) {
        const message = await actionHandler();
        if (message) {
            await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
    } else {
        await interaction.reply({ content: '❌ Unbekannte Aktion!', flags: MessageFlags.Ephemeral });
    }
}

/**
 * Ticket Close Button Handler
 */
async function handleTicketCloseButton(interaction) {
    const channel = interaction.channel;

    db.get(`SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'`, [channel.id], async (err, ticket) => {
        if (err) {
            console.error('Database error:', err);
            await interaction.reply({ 
                content: '❌ Datenbankfehler aufgetreten!', 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }

        if (ticket) {
            try {
                // Get messages for transcript
                const messages = await channel.messages.fetch({ limit: 100 });
                const transcript = messages.reverse().map(msg => ({
                    username: msg.author.username,
                    content: msg.content,
                    timestamp: msg.createdAt.toISOString(),
                    attachments: msg.attachments.map(att => att.url).join(', ')
                }));

                // Update ticket in database
                db.run(`UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE ticket_id = ?`,
                    [new Date().toISOString(), JSON.stringify(transcript), ticket.ticket_id]
                );

                await interaction.reply({ 
                    content: '🔒 **Ticket wird geschlossen...** Transcript wurde gespeichert.\n\n⏱️ Channel wird in 5 Sekunden gelöscht.' 
                });

                // Log system message
                await messageLogger.log('SYSTEM', 'Bot System', 'system', 'Ticket geschlossen', 
                    `Ticket ${ticket.ticket_id} wurde über Discord Button geschlossen.`);

                // Delete channel after delay
                setTimeout(async () => {
                    try {
                        await channel.delete();
                        console.log(`🔒 Ticket Channel gelöscht: ${ticket.ticket_id}`);
                    } catch (deleteError) {
                        console.error('❌ Fehler beim Löschen des Channels:', deleteError);
                    }
                }, 5000);

                console.log(`🔒 Ticket geschlossen: ${ticket.ticket_id}`);
            } catch (error) {
                console.error('❌ Fehler beim Schließen des Tickets:', error);
                await interaction.reply({ 
                    content: '❌ Fehler beim Schließen des Tickets.', 
                    flags: MessageFlags.Ephemeral 
                });
            }
        } else {
            await interaction.reply({ 
                content: '❌ Dies ist kein offenes Ticket oder du hast keine Berechtigung!', 
                flags: MessageFlags.Ephemeral 
            });
        }
    });
}

/**
 * Modal Interaction Handler
 */
async function handleModalInteraction(interaction) {
    const { customId } = interaction;

    if (customId.startsWith('voice_limit_modal_')) {
        const channelId = customId.split('_')[3];
        const channel = interaction.guild.channels.cache.get(channelId);
        const limit = parseInt(interaction.fields.getTextInputValue('limit_input'));

        if (channel && tempChannelManager.channels.has(channelId)) {
            try {
                await channel.setUserLimit(limit);
                await interaction.reply({ 
                    content: `👥 Benutzer-Limit auf ${limit === 0 ? 'unbegrenzt' : limit} gesetzt!`, 
                    flags: MessageFlags.Ephemeral 
                });
            } catch (error) {
                console.error('❌ Fehler beim Setzen des Limits:', error);
                await interaction.reply({ 
                    content: '❌ Fehler beim Setzen des Limits!', 
                    flags: MessageFlags.Ephemeral 
                });
            }
        } else {
            await interaction.reply({ 
                content: '❌ Channel nicht gefunden!', 
                flags: MessageFlags.Ephemeral 
            });
        }
    } else if (customId.startsWith('voice_rename_modal_')) {
        const channelId = customId.split('_')[3];
        const channel = interaction.guild.channels.cache.get(channelId);
        const newName = interaction.fields.getTextInputValue('name_input');

        if (channel && tempChannelManager.channels.has(channelId)) {
            try {
                await channel.setName(newName);
                await interaction.reply({ 
                    content: `✏️ Channel wurde zu "${newName}" umbenannt!`, 
                    flags: MessageFlags.Ephemeral 
                });
            } catch (error) {
                console.error('❌ Fehler beim Umbenennen:', error);
                await interaction.reply({ 
                    content: '❌ Fehler beim Umbenennen!', 
                    flags: MessageFlags.Ephemeral 
                });
            }
        } else {
            await interaction.reply({ 
                content: '❌ Channel nicht gefunden!', 
                flags: MessageFlags.Ephemeral 
            });
        }
    }
}

/**
 * Slash Command Handler
 */
async function handleSlashCommand(interaction) {
    const { commandName } = interaction;

    const commands = {
        'verify': async () => {
            const code = interaction.options.getString('code');
            const result = await userManager.verifyUser(interaction.user.id, code);

            if (result.success) {
                await interaction.reply({ 
                    content: '✅ **Erfolgreich verifiziert!** Willkommen bei 14th Squad!', 
                    flags: MessageFlags.Ephemeral 
                });
                console.log(`✅ Benutzer verifiziert: ${interaction.user.username}`);
            } else {
                await interaction.reply({ 
                    content: `❌ ${result.error}`, 
                    flags: MessageFlags.Ephemeral 
                });
            }
        },

        'ticket': async () => {
            const grund = interaction.options.getString('grund');
            const result = await ticketManager.create(interaction.user, grund);

            if (result.success) {
                await interaction.reply({ 
                    content: `✅ **Ticket erstellt:** ${result.channel}`, 
                    flags: MessageFlags.Ephemeral 
                });
                console.log(`🎫 Neues Ticket: ${result.ticketId} von ${interaction.user.username}`);
            } else {
                await interaction.reply({ 
                    content: `❌ ${result.error}`, 
                    flags: MessageFlags.Ephemeral 
                });
            }
        },

        'close-ticket': async () => {
            const channel = interaction.channel;
            
            // This will be handled by the ticket close button logic
            // but we can also support the slash command
            const ticketResult = await new Promise((resolve) => {
                db.get(`SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'`, [channel.id], (err, ticket) => {
                    if (err || !ticket) {
                        resolve({ success: false, error: 'Dies ist kein offenes Ticket!' });
                    } else {
                        resolve({ success: true, ticket });
                    }
                });
            });

            if (!ticketResult.success) {
                await interaction.reply({ 
                    content: `❌ ${ticketResult.error}`, 
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }

            // Use the ticket manager to close
            const closeResult = await ticketManager.close(ticketResult.ticket.ticket_id, interaction.user.username);
            
            if (closeResult.success) {
                await interaction.reply({ 
                    content: '🔒 **Ticket wird geschlossen...** Transcript wurde gespeichert.\n\n⏱️ Channel wird in 5 Sekunden gelöscht.' 
                });
            } else {
                await interaction.reply({ 
                    content: `❌ ${closeResult.error}`, 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }
    };

    const commandHandler = commands[commandName];
    if (commandHandler) {
        await commandHandler();
    } else {
        await interaction.reply({ 
            content: '❌ Unbekannter Command!', 
            flags: MessageFlags.Ephemeral 
        });
    }
}

/**
 * Register Slash Commands
 */
async function registerSlashCommands() {
    const { REST, Routes } = require('discord.js');

    const commands = [
        {
            name: 'verify',
            description: 'Verifiziere dich mit deinem Code',
            options: [{
                name: 'code',
                description: 'Dein Verifikationscode',
                type: 3,
                required: true
            }]
        },
        {
            name: 'ticket',
            description: 'Erstelle ein Support-Ticket',
            options: [{
                name: 'grund',
                description: 'Grund für das Ticket',
                type: 3,
                required: true
            }]
        },
        {
            name: 'close-ticket',
            description: 'Schließe das aktuelle Ticket'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(CONFIG.BOT_TOKEN);

    try {
        console.log('📝 Registriere Slash Commands...');
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash Commands erfolgreich registriert!');
    } catch (error) {
        console.error('❌ Fehler bei Command-Registrierung:', error);
    }
}

/**
 * Additional Command Handlers for Web Interface
 */
commandProcessor.register('KICK_USER', async (userId, params) => {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(userId);

        if (member) {
            const parameters = params ? JSON.parse(params) : {};
            const reason = parameters.reason || 'Kicked via Web-Interface';

            await member.kick(reason);

            await messageLogger.log('SYSTEM', 'Moderation Bot', 'system', 'User gekickt', 
                `${member.user.username} (${userId}) wurde gekickt. Grund: ${reason}`);

            return `Benutzer ${member.user.username} (${userId}) erfolgreich gekickt`;
        } else {
            return `Benutzer ${userId} nicht gefunden`;
        }
    } catch (error) {
        throw new Error(`Fehler beim Kicken: ${error.message}`);
    }
});

commandProcessor.register('BAN_USER', async (userId, params) => {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const parameters = params ? JSON.parse(params) : {};
        const reason = parameters.reason || 'Banned via Web-Interface';

        let username = 'Unbekannt';
        try {
            const member = await guild.members.fetch(userId);
            username = member.user.username;
        } catch (fetchError) {
            // Member might not be in guild anymore
        }

        await guild.members.ban(userId, { reason: reason });

        await messageLogger.log('SYSTEM', 'Moderation Bot', 'system', 'User gebannt', 
            `${username} (${userId}) wurde gebannt. Grund: ${reason}`);

        return `Benutzer ${username} (${userId}) erfolgreich gebannt`;
    } catch (error) {
        throw new Error(`Fehler beim Bannen: ${error.message}`);
    }
});

commandProcessor.register('TIMEOUT_USER', async (userId, params) => {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(userId);

        if (member) {
            const parameters = params ? JSON.parse(params) : {};
            const duration = parseInt(parameters.duration) || 600;
            const reason = parameters.reason || 'Timeout via Web-Interface';

            const timeoutUntil = new Date(Date.now() + (duration * 1000));
            await member.timeout(timeoutUntil, reason);

            await messageLogger.log('SYSTEM', 'Moderation Bot', 'system', 'User timeout', 
                `${member.user.username} (${userId}) hat einen Timeout erhalten. Dauer: ${duration}s, Grund: ${reason}`);

            return `Benutzer ${member.user.username} (${userId}) für ${duration} Sekunden getimeoutet`;
        } else {
            return `Benutzer ${userId} nicht gefunden`;
        }
    } catch (error) {
        throw new Error(`Fehler beim Timeout: ${error.message}`);
    }
});

/**
 * Error Handling
 */
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
});

process.on('SIGINT', () => {
    console.log('🛑 Shutdown-Signal empfangen...');
    db.close();
    client.destroy();
    process.exit(0);
});

// Login
client.login(CONFIG.BOT_TOKEN);

module.exports = { 
    client, 
    db, 
    avatarManager,
    messageLogger,
    userManager,
    ticketManager,
    tempChannelManager,
    commandProcessor
};