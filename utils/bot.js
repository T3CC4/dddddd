/**
 * Bot Utility Functions
 * Zentrale Sammlung aller Bot-Utility-Funktionen
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const crypto = require('crypto');

// Shared references
let client = null;
let db = null;
let CONFIG = null;

function initialize(discordClient, database, config) {
    client = discordClient;
    db = database;
    CONFIG = config;
}

/**
 * Message Logging System
 */
const messageLogger = {
    async log(messageId, username, channelId, channelName, content, attachments = '', edited = false, user = null) {
        const avatarHash = user?.avatar || null;
        const discriminator = user?.discriminator || null;
        const userId = user?.id || messageId;

        db.run(`INSERT INTO message_logs 
                (message_id, user_id, username, channel_id, channel_name, content, attachments, timestamp, edited, user_avatar_hash, user_discriminator) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [messageId, userId, username, channelId, channelName, content, attachments, new Date().toISOString(), edited, avatarHash, discriminator]
        );
    },

    async handleMessage(message, isEdit = false, isDelete = false) {
        if (message.author?.bot) return;

        // Sync avatar if not deleted
        if (!isDelete && message.author) {
            await avatarManager.sync(message.author);
        }

        if (isDelete) {
            db.run(`UPDATE message_logs SET deleted = 1 WHERE message_id = ?`, [message.id]);
        } else {
            const content = isEdit ? `[BEARBEITET] ${message.content}` : message.content;
            const attachments = message.attachments?.map(att => att.url).join(', ') || '';
            
            await this.log(
                message.id,
                message.author.username,
                message.channel.id,
                message.channel.name,
                content,
                attachments,
                isEdit,
                message.author
            );
        }
    }
};

/**
 * Avatar Management System
 */
const avatarManager = {
    cache: new Map(),
    syncQueue: new Set(),

    async sync(user) {
        if (!user || user.bot || this.syncQueue.has(user.id)) return;
        
        this.syncQueue.add(user.id);
        
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
        } finally {
            this.syncQueue.delete(user.id);
        }
    },

    async bulkSync() {
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
                    await this.sync(member.user);
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
};

/**
 * User Management System
 */
const userManager = {
    async createUser(member) {
        const verificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();

        try {
            await avatarManager.sync(member.user);

            const personalChannel = await member.guild.channels.create({
                name: `welcome-${member.user.username}`,
                type: 0, // Text Channel
                parent: CONFIG.VERIFICATION_CATEGORY,
                permissionOverwrites: [
                    {
                        id: member.guild.id,
                        deny: ['ViewChannel'],
                    },
                    {
                        id: member.user.id,
                        allow: ['ViewChannel', 'SendMessages'],
                    },
                ],
            });

            const embed = embedBuilder.createWelcome(member.user, verificationCode);
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

            await messageLogger.log('SYSTEM', 'System', 'system', 'Neuer Benutzer beigetreten', 
                `${member.user.username} (${member.user.id}) ist dem Server beigetreten.`);

            console.log(`👤 Neuer Benutzer: ${member.user.username} | Code: ${verificationCode}`);
            return { success: true, verificationCode };
        } catch (error) {
            console.error('❌ Fehler bei Benutzer-Erstellung:', error);
            return { success: false, error: error.message };
        }
    },

    async verifyUser(userId, code) {
        return new Promise((resolve) => {
            db.get(`SELECT * FROM users WHERE id = ? AND verification_code = ?`, 
                [userId, code], 
                async (err, row) => {
                    if (err) {
                        console.error('Database error:', err);
                        resolve({ success: false, error: 'Datenbankfehler' });
                        return;
                    }

                    if (row && !row.verified) {
                        db.run(`UPDATE users SET verified = 1 WHERE id = ?`, [userId]);

                        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
                        const member = await guild.members.fetch(userId);
                        const role = guild.roles.cache.get(CONFIG.VERIFIED_ROLE);
                        
                        if (role) {
                            await member.roles.add(role);
                        }

                        // Lösche Welcome Channel
                        if (row.personal_channel_id) {
                            try {
                                const personalChannel = await guild.channels.fetch(row.personal_channel_id);
                                if (personalChannel) {
                                    await personalChannel.delete();
                                }
                            } catch (channelError) {
                                console.log(`⚠️ Channel ${row.personal_channel_id} bereits gelöscht`);
                            }
                        }

                        console.log(`✅ Benutzer verifiziert: ${member.user.username}`);
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: 'Ungültiger Code oder bereits verifiziert' });
                    }
                }
            );
        });
    }
};

/**
 * Embed Builder System
 */
const embedBuilder = {
    createWelcome(user, verificationCode) {
        return new EmbedBuilder()
            .setTitle('🎉 Willkommen bei 14th Squad!')
            .setDescription(`**Hallo ${user.username}!**\n\n🔑 **Dein Verifikationscode:** \`${verificationCode}\`\n\n📝 Verwende \`/verify ${verificationCode}\` um dich zu verifizieren.`)
            .setColor('#ff0066')
            .setThumbnail(user.displayAvatarURL())
            .setFooter({ text: '14th Squad • Verification System' })
            .setTimestamp();
    },

    createTicket(user, reason) {
        return new EmbedBuilder()
            .setTitle('🎫 14th Squad Support Ticket')
            .setDescription(`**Erstellt von:** ${user}\n**Grund:** ${reason}`)
            .setColor('#ff0066')
            .setThumbnail(user.displayAvatarURL())
            .setFooter({ text: '14th Squad • Support System' })
            .setTimestamp();
    },

    createVoiceControl(channel, member) {
        return new EmbedBuilder()
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
    },

    createCloseTicket(ticketId, closedBy) {
        return new EmbedBuilder()
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
    }
};

/**
 * Button Builder System
 */
const buttonBuilder = {
    createTicketClose() {
        return new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('🔒 Ticket schließen')
                    .setStyle(ButtonStyle.Danger)
            );
    },

    createVoiceControls(channelId) {
        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`voice_lock_${channelId}`)
                    .setLabel('🔒 Sperren')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`voice_unlock_${channelId}`)
                    .setLabel('🔓 Entsperren')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`voice_invisible_${channelId}`)
                    .setLabel('👻 Unsichtbar')
                    .setStyle(ButtonStyle.Secondary)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`voice_limit_${channelId}`)
                    .setLabel('👥 Limit ändern')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`voice_rename_${channelId}`)
                    .setLabel('✏️ Umbenennen')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`voice_delete_${channelId}`)
                    .setLabel('🗑️ Löschen')
                    .setStyle(ButtonStyle.Danger)
            );

        return [row1, row2];
    }
};

/**
 * Modal Builder System
 */
const modalBuilder = {
    createVoiceLimit(channelId, currentLimit) {
        const modal = new ModalBuilder()
            .setCustomId(`voice_limit_modal_${channelId}`)
            .setTitle('Voice Channel Limit');

        const limitInput = new TextInputBuilder()
            .setCustomId('limit_input')
            .setLabel('Benutzer-Limit (0 = unbegrenzt)')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setPlaceholder('10')
            .setValue(currentLimit.toString());

        const limitRow = new ActionRowBuilder().addComponents(limitInput);
        modal.addComponents(limitRow);

        return modal;
    },

    createVoiceRename(channelId, currentName) {
        const modal = new ModalBuilder()
            .setCustomId(`voice_rename_modal_${channelId}`)
            .setTitle('Voice Channel umbenennen');

        const nameInput = new TextInputBuilder()
            .setCustomId('name_input')
            .setLabel('Neuer Channel-Name')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(50)
            .setPlaceholder('Mein 14th Squad Channel')
            .setValue(currentName);

        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        modal.addComponents(nameRow);

        return modal;
    }
};

/**
 * Command Processing System
 */
const commandProcessor = {
    commands: new Map(),

    register(commandType, handler) {
        this.commands.set(commandType, handler);
    },

    async process(command) {
        console.log(`🔄 Verarbeite Command: ${command.command_type} für ${command.target_id}`);

        try {
            const handler = this.commands.get(command.command_type);
            
            if (!handler) {
                throw new Error(`Unbekannter Command: ${command.command_type}`);
            }

            const result = await handler(command.target_id, command.parameters);

            db.run(`UPDATE bot_commands SET status = 'completed', executed_at = ?, result = ? WHERE id = ?`,
                [new Date().toISOString(), result, command.id]
            );

            console.log(`✅ Command ${command.id} erfolgreich ausgeführt: ${result}`);
            return { success: true, result };

        } catch (error) {
            console.error(`❌ Fehler bei Command ${command.id}:`, error);

            db.run(`UPDATE bot_commands SET status = 'failed', executed_at = ?, result = ? WHERE id = ?`,
                [new Date().toISOString(), `Fehler: ${error.message}`, command.id]
            );

            return { success: false, error: error.message };
        }
    },

    startProcessor() {
        console.log('🔄 Command Processor gestartet...');

        setInterval(() => {
            db.all(`SELECT * FROM bot_commands WHERE status = 'pending' ORDER BY created_at ASC`, (err, commands) => {
                if (err) {
                    console.error('❌ Fehler beim Laden der Commands:', err);
                    return;
                }

                commands.forEach(command => {
                    this.process(command);
                });
            });
        }, 2000);
    }
};

/**
 * Ticket Management System
 */
const ticketManager = {
    async create(user, reason) {
        const ticketId = `ticket-${Date.now()}`;

        try {
            const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
            const ticketChannel = await guild.channels.create({
                name: ticketId,
                type: 0, // Text Channel
                parent: CONFIG.TICKET_CATEGORY,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel'],
                    },
                    {
                        id: user.id,
                        allow: ['ViewChannel', 'SendMessages'],
                    },
                    {
                        id: CONFIG.MOD_ROLE,
                        allow: ['ViewChannel', 'SendMessages'],
                    },
                    {
                        id: CONFIG.ADMIN_ROLE,
                        allow: ['ViewChannel', 'SendMessages'],
                    },
                ],
            });

            const embed = embedBuilder.createTicket(user, reason);
            const closeButton = buttonBuilder.createTicketClose();

            await ticketChannel.send({ embeds: [embed], components: [closeButton] });

            db.run(`INSERT INTO tickets (ticket_id, user_id, channel_id, status, created_at) VALUES (?, ?, ?, ?, ?)`,
                [ticketId, user.id, ticketChannel.id, 'open', new Date().toISOString()]
            );

            console.log(`🎫 Neues Ticket: ${ticketId} von ${user.username}`);
            return { success: true, ticketId, channel: ticketChannel };

        } catch (error) {
            console.error('❌ Fehler beim Erstellen des Tickets:', error);
            return { success: false, error: error.message };
        }
    },

    async close(ticketId, closedBy = 'System') {
        return new Promise((resolve) => {
            db.get(`SELECT * FROM tickets WHERE ticket_id = ? AND status = 'open'`, [ticketId], async (err, ticket) => {
                if (err) {
                    resolve({ success: false, error: `Datenbankfehler: ${err.message}` });
                    return;
                }

                if (!ticket) {
                    resolve({ success: true, message: 'Ticket nicht gefunden oder bereits geschlossen' });
                    return;
                }

                try {
                    const channel = await client.channels.fetch(ticket.channel_id);

                    if (channel) {
                        const embed = embedBuilder.createCloseTicket(ticketId, closedBy);
                        await channel.send({ embeds: [embed] });

                        setTimeout(async () => {
                            try {
                                await channel.delete();
                                console.log(`🗑️ Channel gelöscht: ${ticket.channel_id}`);
                            } catch (deleteError) {
                                console.error('❌ Fehler beim Löschen des Channels:', deleteError);
                            }
                        }, 5000);

                        resolve({ success: true, message: `Ticket ${ticketId} geschlossen und Channel wird in 5 Sekunden gelöscht` });
                    } else {
                        resolve({ success: true, message: `Ticket ${ticketId} geschlossen, aber Channel nicht gefunden` });
                    }

                } catch (error) {
                    resolve({ success: false, error: `Fehler beim Schließen: ${error.message}` });
                }
            });
        });
    }
};

/**
 * Temp Channel Management System
 */
const tempChannelManager = {
    channels: new Map(),

    async create(member) {
        try {
            const tempChannel = await member.guild.channels.create({
                name: `${member.displayName}'s Squad`,
                type: 2, // Voice Channel
                parent: CONFIG.TEMP_VOICE_CATEGORY,
                userLimit: 10,
                permissionOverwrites: [
                    {
                        id: member.user.id,
                        allow: ['ManageChannels', 'MoveMembers'],
                    },
                ],
            });

            await member.voice.setChannel(tempChannel);

            this.channels.set(tempChannel.id, {
                owner: member.user.id,
                createdAt: Date.now()
            });

            db.run(`INSERT INTO temp_channels (channel_id, owner_id, created_at) VALUES (?, ?, ?)`,
                [tempChannel.id, member.user.id, new Date().toISOString()]
            );

            await this.sendControlPanel(tempChannel, member);

            console.log(`🎤 Temp Channel erstellt: ${tempChannel.name} | Owner: ${member.displayName}`);
            return { success: true, channel: tempChannel };

        } catch (error) {
            console.error('❌ Fehler beim Erstellen des Temp Channels:', error);
            return { success: false, error: error.message };
        }
    },

    async sendControlPanel(channel, member) {
        const embed = embedBuilder.createVoiceControl(channel, member);
        const buttons = buttonBuilder.createVoiceControls(channel.id);

        try {
            await member.send({ 
                content: `🎛️ **14th Squad Voice Control Panel**`,
                embeds: [embed], 
                components: buttons 
            });
            console.log(`📨 Voice Control Panel an ${member.displayName} gesendet`);
        } catch (error) {
            // Fallback to channel if DM fails
            const category = channel.parent;
            const textChannel = category?.children.cache.find(ch => 
                ch.type === 0 && 
                (ch.name.includes('control') || ch.name.includes('commands') || ch.name.includes('general'))
            );

            if (textChannel) {
                await textChannel.send({ 
                    content: `<@${member.id}> 🎛️ **Voice Control Panel:**`,
                    embeds: [embed], 
                    components: buttons 
                });
                console.log(`📨 Voice Control Panel in ${textChannel.name} gesendet`);
            } else {
                console.log(`⚠️ Konnte kein Text-Channel für Voice Control Panel finden`);
            }
        }
    },

    async delete(channelId) {
        try {
            const channel = client.channels.cache.get(channelId);
            if (channel && channel.members.size === 0) {
                await channel.delete();
                this.channels.delete(channelId);

                db.run(`DELETE FROM temp_channels WHERE channel_id = ?`, [channelId]);

                console.log(`🗑️ Leerer Temp Channel gelöscht: ${channel.name}`);
                return { success: true };
            }
            return { success: false, reason: 'Channel not empty or not found' };
        } catch (error) {
            console.error('❌ Fehler beim Löschen des temporären Channels:', error);
            return { success: false, error: error.message };
        }
    }
};

// Register default command handlers
commandProcessor.register('CLOSE_TICKET', ticketManager.close);
commandProcessor.register('TEST', async (targetId, params) => {
    return `Test Command erfolgreich verarbeitet: ${JSON.stringify(params)}`;
});

module.exports = {
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
};