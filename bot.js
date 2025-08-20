const { Client, GatewayIntentBits, Collection, ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const CONFIG = require('./config.js');

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

db.serialize(() => {

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        verification_code TEXT,
        verified BOOLEAN DEFAULT 0,
        joined_at DATETIME,
        personal_channel_id TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS message_logs (
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
        deleted BOOLEAN DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT UNIQUE,
        user_id TEXT,
        channel_id TEXT,
        status TEXT DEFAULT 'open',
        created_at DATETIME,
        closed_at DATETIME,
        transcript TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS temp_channels (
        channel_id TEXT PRIMARY KEY,
        owner_id TEXT,
        created_at DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS web_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        unique_password TEXT,
        created_at DATETIME,
        last_login DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS web_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        timestamp DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bot_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        parameters TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME,
        result TEXT
    )`);
});

const tempChannels = new Collection();
const activeTickets = new Collection();

function startCommandProcessor() {
    console.log('🔄 Command Processor gestartet...');

    setInterval(() => {
        db.all(`SELECT * FROM bot_commands WHERE status = 'pending' ORDER BY created_at ASC`, (err, commands) => {
            if (err) {
                console.error('❌ Fehler beim Laden der Commands:', err);
                return;
            }

            commands.forEach(command => {
                processCommand(command);
            });
        });
    }, 2000); 
}

async function processCommand(command) {
    console.log(`🔄 Verarbeite Command: ${command.command_type} für ${command.target_id}`);

    try {
        let result = '';

        switch (command.command_type) {
            case 'CLOSE_TICKET':
                result = await closeTicketFromWebsite(command.target_id, command.parameters);
                break;

            case 'DELETE_CHANNEL':
                result = await deleteChannelFromWebsite(command.target_id);
                break;

            case 'KICK_USER':
                result = await kickUserFromWebsite(command.target_id, command.parameters);
                break;

            case 'BAN_USER':
                result = await banUserFromWebsite(command.target_id, command.parameters);
                break;

            case 'TIMEOUT_USER':
                result = await timeoutUserFromWebsite(command.target_id, command.parameters);
                break;

            case 'TEST':
                result = `Test Command erfolgreich verarbeitet: ${command.parameters}`;
                break;

            default:
                result = `Unbekannter Command: ${command.command_type}`;
        }

        db.run(`UPDATE bot_commands SET status = 'completed', executed_at = ?, result = ? WHERE id = ?`,
            [new Date().toISOString(), result, command.id]
        );

        console.log(`✅ Command ${command.id} erfolgreich ausgeführt: ${result}`);

    } catch (error) {
        console.error(`❌ Fehler bei Command ${command.id}:`, error);

        db.run(`UPDATE bot_commands SET status = 'failed', executed_at = ?, result = ? WHERE id = ?`,
            [new Date().toISOString(), `Fehler: ${error.message}`, command.id]
        );
    }
}

async function closeTicketFromWebsite(ticketId, parameters) {
    console.log(`🎫 Schließe Ticket: ${ticketId}`);

    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM tickets WHERE ticket_id = ? AND status = 'open'`, [ticketId], async (err, ticket) => {
            if (err) {
                reject(new Error(`Datenbankfehler: ${err.message}`));
                return;
            }

            if (!ticket) {
                resolve('Ticket nicht gefunden oder bereits geschlossen');
                return;
            }

            try {

                const channel = await client.channels.fetch(ticket.channel_id);

                if (channel) {

                    const params = parameters ? JSON.parse(parameters) : {};
                    const closedBy = params.closedBy || 'Web-Interface';

                    const embed = new EmbedBuilder()
                        .setTitle('🔒 Ticket wird geschlossen')
                        .setDescription('Dieses Ticket wurde über das Web-Interface geschlossen.')
                        .setColor('#ff0066')
                        .addFields(
                            { name: 'Ticket ID', value: `\`${ticketId}\``, inline: true },
                            { name: 'Geschlossen von', value: closedBy, inline: true },
                            { name: 'Zeitpunkt', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                        )
                        .setFooter({ text: '14th Squad • Ticket System' })
                        .setTimestamp();

                    await channel.send({ embeds: [embed] });

                    setTimeout(async () => {
                        try {
                            await channel.delete();
                            console.log(`🗑️ Channel gelöscht: ${ticket.channel_id}`);
                        } catch (deleteError) {
                            console.error('❌ Fehler beim Löschen des Channels:', deleteError);
                        }
                    }, 5000);

                    resolve(`Ticket ${ticketId} geschlossen und Channel wird in 5 Sekunden gelöscht`);
                } else {
                    resolve(`Ticket ${ticketId} geschlossen, aber Channel nicht gefunden`);
                }

            } catch (error) {
                reject(new Error(`Fehler beim Schließen: ${error.message}`));
            }
        });
    });
}

async function deleteChannelFromWebsite(channelId) {
    console.log(`🗑️ Lösche Channel: ${channelId}`);

    try {
        const channel = await client.channels.fetch(channelId);

        if (channel) {
            await channel.delete();
            return `Channel ${channelId} erfolgreich gelöscht`;
        } else {
            return `Channel ${channelId} nicht gefunden`;
        }
    } catch (error) {
        throw new Error(`Fehler beim Löschen des Channels: ${error.message}`);
    }
}

async function kickUserFromWebsite(userId, parameters) {
    console.log(`👢 Kicke Benutzer: ${userId}`);

    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(userId);

        if (member) {
            const params = parameters ? JSON.parse(parameters) : {};
            const reason = params.reason || 'Kicked via Web-Interface';

            await member.kick(reason);

            logMessage('SYSTEM', 'Moderation Bot', 'system', 'User gekickt', 
                `${member.user.username} (${userId}) wurde gekickt. Grund: ${reason}`);

            return `Benutzer ${member.user.username} (${userId}) erfolgreich gekickt`;
        } else {
            return `Benutzer ${userId} nicht gefunden`;
        }
    } catch (error) {
        throw new Error(`Fehler beim Kicken: ${error.message}`);
    }
}

async function banUserFromWebsite(userId, parameters) {
    console.log(`🔨 Banne Benutzer: ${userId}`);

    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const params = parameters ? JSON.parse(parameters) : {};
        const reason = params.reason || 'Banned via Web-Interface';

        let username = 'Unbekannt';
        try {
            const member = await guild.members.fetch(userId);
            username = member.user.username;
        } catch (fetchError) {

        }

        await guild.members.ban(userId, { reason: reason });

        logMessage('SYSTEM', 'Moderation Bot', 'system', 'User gebannt', 
            `${username} (${userId}) wurde gebannt. Grund: ${reason}`);

        return `Benutzer ${username} (${userId}) erfolgreich gebannt`;
    } catch (error) {
        throw new Error(`Fehler beim Bannen: ${error.message}`);
    }
}

async function timeoutUserFromWebsite(userId, parameters) {
    console.log(`⏰ Timeout für Benutzer: ${userId}`);

    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(userId);

        if (member) {
            const params = parameters ? JSON.parse(parameters) : {};
            const duration = parseInt(params.duration) || 600; 
            const reason = params.reason || 'Timeout via Web-Interface';

            const timeoutUntil = new Date(Date.now() + (duration * 1000));
            await member.timeout(timeoutUntil, reason);

            logMessage('SYSTEM', 'Moderation Bot', 'system', 'User timeout', 
                `${member.user.username} (${userId}) hat einen Timeout erhalten. Dauer: ${duration}s, Grund: ${reason}`);

            return `Benutzer ${member.user.username} (${userId}) für ${duration} Sekunden getimeoutet`;
        } else {
            return `Benutzer ${userId} nicht gefunden`;
        }
    } catch (error) {
        throw new Error(`Fehler beim Timeout: ${error.message}`);
    }
}

client.once('ready', () => {
    console.log(`🤖 14th Squad Bot ist online als ${client.user.tag}!`);
    console.log(`📡 Verbunden mit Server: ${client.guilds.cache.first()?.name}`);
    console.log(`👥 Server-Mitglieder: ${client.guilds.cache.first()?.memberCount}`);

    startCommandProcessor();

    setTimeout(() => {
        bulkSyncAvatars();
    }, 30000);

    setInterval(() => {
        bulkSyncAvatars();
    }, 6 * 60 * 60 * 1000);

    client.user.setActivity('14th Squad Management', { type: 'WATCHING' });
});

client.on('guildMemberAdd', async (member) => {
    const verificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    try {

        await syncUserAvatar(member.user);

        const personalChannel = await member.guild.channels.create({
            name: `welcome-${member.user.username}`,
            type: ChannelType.GuildText,
            parent: CONFIG.VERIFICATION_CATEGORY,
            permissionOverwrites: [
                {
                    id: member.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: member.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
            ],
        });

        const embed = new EmbedBuilder()
            .setTitle('🎉 Willkommen bei 14th Squad!')
            .setDescription(`**Hallo ${member.user.username}!**\n\n🔑 **Dein Verifikationscode:** \`${verificationCode}\`\n\n📝 Verwende \`/verify ${verificationCode}\` um dich zu verifizieren.`)
            .setColor('#ff0066')
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: '14th Squad • Verification System' })
            .setTimestamp();

        await personalChannel.send({ embeds: [embed] });

        db.run(`INSERT OR REPLACE INTO users 
                (id, username, verification_code, verified, joined_at, personal_channel_id, avatar_hash, discriminator, last_seen) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                member.user.id, 
                member.user.username, 
                verificationCode, 
                0, 
                new Date().toISOString(), 
                personalChannel.id,
                member.user.avatar,
                member.user.discriminator,
                new Date().toISOString()
            ]
        );

        logMessage('SYSTEM', 'System', 'system', 'Neuer Benutzer beigetreten', 
            `${member.user.username} (${member.user.id}) ist dem Server beigetreten.`);

        console.log(`👤 Neuer Benutzer: ${member.user.username} | Code: ${verificationCode}`);
    } catch (error) {
        console.error('❌ Fehler bei Benutzer-Beitritt:', error);
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {

        if (newState.channelId === CONFIG.JOIN_TO_CREATE_CHANNEL) {
            const member = newState.member;

            const tempChannel = await newState.guild.channels.create({
                name: `${member.displayName}'s Squad`,
                type: ChannelType.GuildVoice,
                parent: CONFIG.TEMP_VOICE_CATEGORY,
                userLimit: 10,
                permissionOverwrites: [
                    {
                        id: member.user.id,
                        allow: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MoveMembers],
                    },
                ],
            });

            await member.voice.setChannel(tempChannel);

            tempChannels.set(tempChannel.id, {
                owner: member.user.id,
                createdAt: Date.now()
            });

            db.run(`INSERT INTO temp_channels (channel_id, owner_id, created_at) VALUES (?, ?, ?)`,
                [tempChannel.id, member.user.id, new Date().toISOString()]
            );

            await sendVoiceControlPanel(tempChannel, member);

            console.log(`🎤 Temp Channel erstellt: ${tempChannel.name} | Owner: ${member.displayName}`);
        }

        if (oldState.channel && tempChannels.has(oldState.channelId)) {
            if (oldState.channel.members.size === 0) {
                try {
                    await oldState.channel.delete();
                    tempChannels.delete(oldState.channelId);

                    db.run(`DELETE FROM temp_channels WHERE channel_id = ?`, [oldState.channelId]);

                    console.log(`🗑️ Leerer Temp Channel gelöscht: ${oldState.channel.name}`);
                } catch (error) {
                    console.error('❌ Fehler beim Löschen des temporären Channels:', error);
                }
            }
        }
    } catch (error) {
        console.error('❌ Fehler bei Voice State Update:', error);
    }
});

async function sendVoiceControlPanel(channel, member) {
    const embed = new EmbedBuilder()
        .setTitle('🎛️ 14th Squad Voice Control')
        .setDescription(`**Channel:** ${channel.name}\n**Owner:** ${member.displayName}`)
        .setColor('#ff0066')
        .addFields(
            { name: '🔒 Sperren/Entsperren', value: 'Channel für andere sperren', inline: true },
            { name: '👥 Limit', value: 'Benutzeranzahl begrenzen', inline: true },
            { name: '✏️ Name', value: 'Channel umbenennen', inline: true }
        )
        .setFooter({ text: '14th Squad • Voice Management System' })
        .setTimestamp();

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`voice_lock_${channel.id}`)
                .setLabel('🔒 Sperren')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`voice_unlock_${channel.id}`)
                .setLabel('🔓 Entsperren')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`voice_invisible_${channel.id}`)
                .setLabel('👻 Unsichtbar')
                .setStyle(ButtonStyle.Secondary)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`voice_limit_${channel.id}`)
                .setLabel('👥 Limit ändern')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`voice_rename_${channel.id}`)
                .setLabel('✏️ Umbenennen')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`voice_delete_${channel.id}`)
                .setLabel('🗑️ Löschen')
                .setStyle(ButtonStyle.Danger)
        );

    try {
        await member.send({ 
            content: `🎛️ **14th Squad Voice Control Panel**`,
            embeds: [embed], 
            components: [row1, row2] 
        });
        console.log(`📨 Voice Control Panel an ${member.displayName} gesendet`);
    } catch (error) {

        const category = channel.parent;
        const textChannel = category?.children.cache.find(ch => 
            ch.type === ChannelType.GuildText && 
            (ch.name.includes('control') || ch.name.includes('commands') || ch.name.includes('general'))
        );

        if (textChannel) {
            await textChannel.send({ 
                content: `<@${member.id}> 🎛️ **Voice Control Panel:**`,
                embeds: [embed], 
                components: [row1, row2] 
            });
            console.log(`📨 Voice Control Panel in ${textChannel.name} gesendet`);
        } else {
            console.log(`⚠️ Konnte kein Text-Channel für Voice Control Panel finden`);
        }
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (!message.author.bot) {
        await syncUserAvatar(message.author);
    }

    logMessage(
        message.id,
        message.author.username,
        message.channel.id,
        message.channel.name,
        message.content,
        message.attachments.map(att => att.url).join(', '),
        false,
        message.author
    );
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.author?.bot) return;

    if (!newMessage.author.bot) {
        await syncUserAvatar(newMessage.author);
    }

    logMessage(
        newMessage.id,
        newMessage.author.username,
        newMessage.channel.id,
        newMessage.channel.name,
        `[BEARBEITET] ${newMessage.content}`,
        '',
        true,
        newMessage.author
    );
});

client.on('messageDelete', async (message) => {
    if (message.author?.bot) return;

    db.run(`UPDATE message_logs SET deleted = 1 WHERE message_id = ?`, [message.id]);
});

function logMessage(messageId, username, channelId, channelName, content, attachments = '', edited = false, user = null) {
    const avatarHash = user?.avatar || null;
    const discriminator = user?.discriminator || null;

    db.run(`INSERT INTO message_logs 
            (message_id, user_id, username, channel_id, channel_name, content, attachments, timestamp, edited, user_avatar_hash, user_discriminator) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            messageId, 
            messageId === 'SYSTEM' ? 'SYSTEM' : messageId, 
            username, 
            channelId, 
            channelName, 
            content, 
            attachments, 
            new Date().toISOString(), 
            edited,
            avatarHash,
            discriminator
        ]
    );
}

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

(async () => {
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
})();

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const { customId } = interaction;

    if (customId.startsWith('voice_')) {
        const parts = customId.split('_');
        const action = parts[1];
        const channelId = parts[2];

        const channel = interaction.guild.channels.cache.get(channelId);

        if (!channel || !tempChannels.has(channelId)) {
            return interaction.reply({ 
                content: '❌ Channel nicht gefunden oder nicht berechtigt!', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const channelData = tempChannels.get(channelId);
        if (channelData.owner !== interaction.user.id) {
            return interaction.reply({ 
                content: '❌ Nur der Channel-Owner kann diese Aktion ausführen!', 
                flags: MessageFlags.Ephemeral 
            });
        }

        try {
            switch (action) {
                case 'lock':
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        Connect: false
                    });
                    await interaction.reply({ 
                        content: '🔒 Voice Channel wurde gesperrt!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    break;

                case 'unlock':
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        Connect: null
                    });
                    await interaction.reply({ 
                        content: '🔓 Voice Channel wurde entsperrt!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    break;

                case 'invisible':
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        ViewChannel: false
                    });
                    await interaction.reply({ 
                        content: '👻 Voice Channel ist jetzt unsichtbar!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    break;

                case 'limit':

                    const limitModal = new ModalBuilder()
                        .setCustomId(`voice_limit_modal_${channelId}`)
                        .setTitle('Voice Channel Limit');

                    const limitInput = new TextInputBuilder()
                        .setCustomId('limit_input')
                        .setLabel('Benutzer-Limit (0 = unbegrenzt)')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1)
                        .setMaxLength(2)
                        .setPlaceholder('10')
                        .setValue(channel.userLimit.toString());

                    const limitRow = new ActionRowBuilder().addComponents(limitInput);
                    limitModal.addComponents(limitRow);

                    await interaction.showModal(limitModal);
                    break;

                case 'rename':

                    const renameModal = new ModalBuilder()
                        .setCustomId(`voice_rename_modal_${channelId}`)
                        .setTitle('Voice Channel umbenennen');

                    const nameInput = new TextInputBuilder()
                        .setCustomId('name_input')
                        .setLabel('Neuer Channel-Name')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1)
                        .setMaxLength(50)
                        .setPlaceholder('Mein 14th Squad Channel')
                        .setValue(channel.name);

                    const nameRow = new ActionRowBuilder().addComponents(nameInput);
                    renameModal.addComponents(nameRow);

                    await interaction.showModal(renameModal);
                    break;

                case 'delete':
                    await channel.delete();
                    tempChannels.delete(channelId);
                    db.run(`DELETE FROM temp_channels WHERE channel_id = ?`, [channelId]);
                    await interaction.reply({ 
                        content: '🗑️ Voice Channel wurde gelöscht!', 
                        flags: MessageFlags.Ephemeral 
                    });
                    break;
            }
        } catch (error) {
            console.error('❌ Voice Control Error:', error);
            await interaction.reply({ 
                content: '❌ Fehler bei der Ausführung!', 
                flags: MessageFlags.Ephemeral 
            });
        }
    }

    if (customId === 'close_ticket') {
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

                    const messages = await channel.messages.fetch({ limit: 100 });
                    const transcript = messages.reverse().map(msg => ({
                        username: msg.author.username,
                        content: msg.content,
                        timestamp: msg.createdAt.toISOString(),
                        attachments: msg.attachments.map(att => att.url).join(', ')
                    }));

                    db.run(`UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE ticket_id = ?`,
                        [new Date().toISOString(), JSON.stringify(transcript), ticket.ticket_id]
                    );

                    await interaction.reply({ 
                        content: '🔒 **Ticket wird geschlossen...** Transcript wurde gespeichert.\n\n⏱️ Channel wird in 5 Sekunden gelöscht.' 
                    });

                    logMessage('SYSTEM', 'Bot System', 'system', 'Ticket geschlossen', 
                        `Ticket ${ticket.ticket_id} wurde über Discord Button geschlossen.`);

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
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const { customId } = interaction;

    if (customId.startsWith('voice_limit_modal_')) {
        const channelId = customId.split('_')[3];
        const channel = interaction.guild.channels.cache.get(channelId);
        const limit = parseInt(interaction.fields.getTextInputValue('limit_input'));

        if (channel && tempChannels.has(channelId)) {
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
    }

    if (customId.startsWith('voice_rename_modal_')) {
        const channelId = customId.split('_')[3];
        const channel = interaction.guild.channels.cache.get(channelId);
        const newName = interaction.fields.getTextInputValue('name_input');

        if (channel && tempChannels.has(channelId)) {
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
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'verify') {
            const code = interaction.options.getString('code');

            db.get(`SELECT * FROM users WHERE id = ? AND verification_code = ?`, 
                [interaction.user.id, code], 
                async (err, row) => {
                    if (err) {
                        console.error('Database error:', err);
                        await interaction.reply({ 
                            content: '❌ Datenbankfehler aufgetreten!', 
                            flags: MessageFlags.Ephemeral 
                        });
                        return;
                    }

                    if (row && !row.verified) {

                        db.run(`UPDATE users SET verified = 1 WHERE id = ?`, [interaction.user.id]);

                        const role = interaction.guild.roles.cache.get(CONFIG.VERIFIED_ROLE);
                        if (role) {
                            await interaction.member.roles.add(role);
                        }

                        if (row.personal_channel_id) {
                            try {
                                const personalChannel = await interaction.guild.channels.fetch(row.personal_channel_id);
                                if (personalChannel) {
                                    await personalChannel.delete();
                                }
                            } catch (channelError) {
                                console.log(`⚠️ Persönlicher Channel ${row.personal_channel_id} nicht gefunden oder bereits gelöscht`);

                            }
                        }

                        await interaction.reply({ 
                            content: '✅ **Erfolgreich verifiziert!** Willkommen bei 14th Squad!', 
                            flags: MessageFlags.Ephemeral 
                        });

                        console.log(`✅ Benutzer verifiziert: ${interaction.user.username}`);
                    } else {
                        await interaction.reply({ 
                            content: '❌ Ungültiger Code oder bereits verifiziert!', 
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                }
            );
        }

        if (commandName === 'ticket') {
            const grund = interaction.options.getString('grund');
            const ticketId = `ticket-${Date.now()}`;

            try {
                const ticketChannel = await interaction.guild.channels.create({
                    name: ticketId,
                    type: ChannelType.GuildText,
                    parent: CONFIG.TICKET_CATEGORY,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        },
                        {
                            id: CONFIG.MOD_ROLE,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        },
                        {
                            id: CONFIG.ADMIN_ROLE,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        },
                    ],
                });

                const embed = new EmbedBuilder()
                    .setTitle('🎫 14th Squad Support Ticket')
                    .setDescription(`**Erstellt von:** ${interaction.user}\n**Grund:** ${grund}`)
                    .setColor('#ff0066')
                    .setThumbnail(interaction.user.displayAvatarURL())
                    .setFooter({ text: '14th Squad • Support System' })
                    .setTimestamp();

                const closeButton = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('close_ticket')
                            .setLabel('🔒 Ticket schließen')
                            .setStyle(ButtonStyle.Danger)
                    );

                await ticketChannel.send({ embeds: [embed], components: [closeButton] });

                db.run(`INSERT INTO tickets (ticket_id, user_id, channel_id, status, created_at) VALUES (?, ?, ?, ?, ?)`,
                    [ticketId, interaction.user.id, ticketChannel.id, 'open', new Date().toISOString()]
                );

                await interaction.reply({ 
                    content: `✅ **Ticket erstellt:** ${ticketChannel}`, 
                    flags: MessageFlags.Ephemeral 
                });

                console.log(`🎫 Neues Ticket: ${ticketId} von ${interaction.user.username}`);
            } catch (error) {
                console.error('❌ Fehler beim Erstellen des Tickets:', error);
                await interaction.reply({ 
                    content: '❌ Fehler beim Erstellen des Tickets. Bitte versuche es später erneut.', 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }

        if (commandName === 'close-ticket') {

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

                        const messages = await channel.messages.fetch({ limit: 100 });
                        const transcript = messages.reverse().map(msg => ({
                            username: msg.author.username,
                            content: msg.content,
                            timestamp: msg.createdAt.toISOString(),
                            attachments: msg.attachments.map(att => att.url).join(', ')
                        }));

                        db.run(`UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE ticket_id = ?`,
                            [new Date().toISOString(), JSON.stringify(transcript), ticket.ticket_id]
                        );

                        await interaction.reply({ 
                            content: '🔒 **Ticket wird geschlossen...** Transcript wurde gespeichert.\n\n⏱️ Channel wird in 5 Sekunden gelöscht.' 
                        });

                        logMessage('SYSTEM', 'Bot System', 'system', 'Ticket geschlossen', 
                            `Ticket ${ticket.ticket_id} wurde über Slash Command geschlossen.`);

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
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ 
                                content: '❌ Fehler beim Schließen des Tickets.', 
                                flags: MessageFlags.Ephemeral 
                            });
                        }
                    }
                } else {
                    await interaction.reply({ 
                        content: '❌ Dies ist kein offenes Ticket oder du hast keine Berechtigung!', 
                        flags: MessageFlags.Ephemeral 
                    });
                }
            });
        }
    } catch (error) {
        console.error('❌ Fehler bei Slash Command:', error);

        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ Ein Fehler ist aufgetreten!', 
                    flags: MessageFlags.Ephemeral 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ Ein Fehler ist aufgetreten!' 
                });
            }
        } catch (replyError) {
            console.error('❌ Fehler beim Senden der Fehlerantwort:', replyError);
        }
    }
});

async function syncUserAvatar(user) {
    try {
        const avatarHash = user.avatar;
        const discriminator = user.discriminator;
        const username = user.username || user.globalName;

        db.run(`
            UPDATE users 
            SET avatar_hash = ?, discriminator = ?, username = ?, last_seen = ?
            WHERE id = ?
        `, [avatarHash, discriminator, username, new Date().toISOString(), user.id], (err) => {
            if (err) {
                console.error('Avatar sync error:', err);
            } else {
                console.log(`✅ Avatar synced for ${username} (${user.id})`);
            }
        });
    } catch (error) {
        console.error('Avatar sync error:', error);
    }
}

async function syncAllAvatarsCommand() {
    console.log('📤 Manueller Avatar Sync gestartet...');
    await bulkSyncAvatars();
}

async function bulkSyncAvatars() {
    console.log('🔄 Starte Bulk Avatar Sync...');

    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (!guild) {
            console.error('Guild nicht gefunden');
            return;
        }

        const members = await guild.members.fetch();
        console.log(`📥 ${members.size} Mitglieder gefunden`);

        let syncCount = 0;
        for (const [id, member] of members) {
            if (!member.user.bot) {
                await syncUserAvatar(member.user);
                syncCount++;

                if (syncCount % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    console.log(`📊 ${syncCount}/${members.size - members.filter(m => m.user.bot).size} Avatare synchronisiert`);
                }
            }
        }

        console.log(`✅ Bulk Avatar Sync abgeschlossen: ${syncCount} Benutzer`);
    } catch (error) {
        console.error('❌ Bulk Avatar Sync Fehler:', error);
    }
}

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

client.login(CONFIG.BOT_TOKEN);

module.exports = { 
    client, 
    db, 
    syncUserAvatar, 
    bulkSyncAvatars,
    syncAllAvatarsCommand
};