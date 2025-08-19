const { Client, GatewayIntentBits, Collection, ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const CONFIG = require('./config.js');

// Bot Setup
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

// Datenbank Setup
const db = new sqlite3.Database('./bot_database.sqlite');

// Initialisiere Datenbank
db.serialize(() => {
    // Benutzer Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        verification_code TEXT,
        verified BOOLEAN DEFAULT 0,
        joined_at DATETIME,
        personal_channel_id TEXT
    )`);
    
    // Nachrichten Log
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
    
    // Tickets
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
    
    // Temp Voice Channels
    db.run(`CREATE TABLE IF NOT EXISTS temp_channels (
        channel_id TEXT PRIMARY KEY,
        owner_id TEXT,
        created_at DATETIME
    )`);
    
    // Web Benutzer
    db.run(`CREATE TABLE IF NOT EXISTS web_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        unique_password TEXT,
        created_at DATETIME,
        last_login DATETIME
    )`);
    
    // Web Logs (OHNE IP aus Sicherheitsgründen) 
    db.run(`CREATE TABLE IF NOT EXISTS web_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        timestamp DATETIME
    )`);
});

// Collections für temporäre Daten
const tempChannels = new Collection();
const activeTickets = new Collection();

client.once('ready', () => {
    console.log(`🤖 14th Squad Bot ist online als ${client.user.tag}!`);
    console.log(`📡 Verbunden mit Server: ${client.guilds.cache.first()?.name}`);
});

// Event: Neuer Benutzer tritt Server bei
client.on('guildMemberAdd', async (member) => {
    const verificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    try {
        // Erstelle persönlichen Channel
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
        
        // Speichere in Datenbank
        db.run(`INSERT OR REPLACE INTO users (id, username, verification_code, verified, joined_at, personal_channel_id) 
                VALUES (?, ?, ?, ?, ?, ?)`,
            [member.user.id, member.user.username, verificationCode, 0, new Date().toISOString(), personalChannel.id]
        );
        
        logMessage('SYSTEM', 'System', 'system', 'Neuer Benutzer beigetreten', `${member.user.username} (${member.user.id}) ist dem Server beigetreten.`);
        
        console.log(`👤 Neuer Benutzer: ${member.user.username} | Code: ${verificationCode}`);
    } catch (error) {
        console.error('❌ Fehler bei Benutzer-Beitritt:', error);
    }
});

// Event: Voice State Update für Temp Voice Channels
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        // Benutzer betritt "Join to Create" Channel
        if (newState.channelId === CONFIG.JOIN_TO_CREATE_CHANNEL) {
            const member = newState.member;
            
            // Erstelle temporären Voice Channel
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
            
            // Bewege Benutzer in neuen Channel
            await member.voice.setChannel(tempChannel);
            
            // Speichere Channel Info
            tempChannels.set(tempChannel.id, {
                owner: member.user.id,
                createdAt: Date.now()
            });
            
            db.run(`INSERT INTO temp_channels (channel_id, owner_id, created_at) VALUES (?, ?, ?)`,
                [tempChannel.id, member.user.id, new Date().toISOString()]
            );
            
            // Sende Control Panel
            await sendVoiceControlPanel(tempChannel, member);
            
            console.log(`🎤 Temp Channel erstellt: ${tempChannel.name} | Owner: ${member.displayName}`);
        }
        
        // Lösche leere temporäre Channels
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

// Voice Control Panel für 14th Squad
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
    
    // Sende Control Panel in den Voice Channel (als Nachricht an den Owner)
    try {
        await member.send({ 
            content: `🎛️ **14th Squad Voice Control Panel**`,
            embeds: [embed], 
            components: [row1, row2] 
        });
        console.log(`📨 Voice Control Panel an ${member.displayName} gesendet`);
    } catch (error) {
        // Falls DM fehlschlägt, suche Text-Channel in derselben Kategorie
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

// Event: Nachrichten loggen
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    logMessage(
        message.id,
        message.author.username,
        message.channel.id,
        message.channel.name,
        message.content,
        message.attachments.map(att => att.url).join(', ')
    );
});

// Event: Nachrichten bearbeitet
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.author?.bot) return;
    
    logMessage(
        newMessage.id,
        newMessage.author.username,
        newMessage.channel.id,
        newMessage.channel.name,
        `[BEARBEITET] ${newMessage.content}`,
        '',
        true
    );
});

// Event: Nachrichten gelöscht
client.on('messageDelete', async (message) => {
    if (message.author?.bot) return;
    
    db.run(`UPDATE message_logs SET deleted = 1 WHERE message_id = ?`, [message.id]);
});

// Hilfsfunktion: Nachricht loggen
function logMessage(messageId, username, channelId, channelName, content, attachments = '', edited = false) {
    db.run(`INSERT INTO message_logs 
            (message_id, user_id, username, channel_id, channel_name, content, attachments, timestamp, edited) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [messageId, messageId === 'SYSTEM' ? 'SYSTEM' : messageId, username, channelId, channelName, content, attachments, new Date().toISOString(), edited]
    );
}

// Slash Commands Setup
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

// Commands registrieren
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

// Button Interaction Handler für Voice Controls
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const { customId } = interaction;
    
    // Voice Channel Controls
    if (customId.startsWith('voice_')) {
        const parts = customId.split('_');
        const action = parts[1];
        const channelId = parts[2];
        
        const channel = interaction.guild.channels.cache.get(channelId);
        
        if (!channel || !tempChannels.has(channelId)) {
            return interaction.reply({ content: '❌ Channel nicht gefunden oder nicht berechtigt!', ephemeral: true });
        }
        
        const channelData = tempChannels.get(channelId);
        if (channelData.owner !== interaction.user.id) {
            return interaction.reply({ content: '❌ Nur der Channel-Owner kann diese Aktion ausführen!', ephemeral: true });
        }
        
        try {
            switch (action) {
                case 'lock':
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        Connect: false
                    });
                    await interaction.reply({ content: '🔒 Voice Channel wurde gesperrt!', ephemeral: true });
                    break;
                
                case 'unlock':
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        Connect: null
                    });
                    await interaction.reply({ content: '🔓 Voice Channel wurde entsperrt!', ephemeral: true });
                    break;
                
                case 'invisible':
                    await channel.permissionOverwrites.edit(interaction.guild.id, {
                        ViewChannel: false
                    });
                    await interaction.reply({ content: '👻 Voice Channel ist jetzt unsichtbar!', ephemeral: true });
                    break;
                
                case 'limit':
                    // Modal für Limit-Eingabe
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
                    // Modal für Namen-Eingabe
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
                    await interaction.reply({ content: '🗑️ Voice Channel wurde gelöscht!', ephemeral: true });
                    break;
            }
        } catch (error) {
            console.error('❌ Voice Control Error:', error);
            await interaction.reply({ content: '❌ Fehler bei der Ausführung!', ephemeral: true });
        }
    }
    
    // Ticket schließen Button
    if (customId === 'close_ticket') {
        // Ticket schließen Logik hier...
        await interaction.reply({ content: '🔒 Ticket wird geschlossen...', ephemeral: true });
    }
});

// Modal Submit Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    
    const { customId } = interaction;
    
    if (customId.startsWith('voice_limit_modal_')) {
        const channelId = customId.split('_')[3];
        const channel = interaction.guild.channels.cache.get(channelId);
        const limit = parseInt(interaction.fields.getTextInputValue('limit_input'));
        
        if (channel && tempChannels.has(channelId)) {
            await channel.setUserLimit(limit);
            await interaction.reply({ 
                content: `👥 Benutzer-Limit auf ${limit === 0 ? 'unbegrenzt' : limit} gesetzt!`, 
                ephemeral: true 
            });
        }
    }
    
    if (customId.startsWith('voice_rename_modal_')) {
        const channelId = customId.split('_')[3];
        const channel = interaction.guild.channels.cache.get(channelId);
        const newName = interaction.fields.getTextInputValue('name_input');
        
        if (channel && tempChannels.has(channelId)) {
            await channel.setName(newName);
            await interaction.reply({ 
                content: `✏️ Channel wurde zu "${newName}" umbenannt!`, 
                ephemeral: true 
            });
        }
    }
});

// Slash Command Handler  
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName } = interaction;
    
    try {
        if (commandName === 'verify') {
            const code = interaction.options.getString('code');
            
            db.get(`SELECT * FROM users WHERE id = ? AND verification_code = ?`, 
                [interaction.user.id, code], 
                async (err, row) => {
                    if (row && !row.verified) {
                        // Verifiziere Benutzer
                        db.run(`UPDATE users SET verified = 1 WHERE id = ?`, [interaction.user.id]);
                        
                        const role = interaction.guild.roles.cache.get(CONFIG.VERIFIED_ROLE);
                        if (role) {
                            await interaction.member.roles.add(role);
                        }
                        
                        // Lösche persönlichen Channel
                        const personalChannel = interaction.guild.channels.cache.get(row.personal_channel_id);
                        if (personalChannel) {
                            await personalChannel.delete();
                        }
                        
                        await interaction.reply({ 
                            content: '✅ **Erfolgreich verifiziert!** Willkommen bei 14th Squad!', 
                            ephemeral: true 
                        });
                        
                        console.log(`✅ Benutzer verifiziert: ${interaction.user.username}`);
                    } else {
                        await interaction.reply({ 
                            content: '❌ Ungültiger Code oder bereits verifiziert!', 
                            ephemeral: true 
                        });
                    }
                }
            );
        }
        
        if (commandName === 'ticket') {
            const grund = interaction.options.getString('grund');
            const ticketId = `ticket-${Date.now()}`;
            
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
            
            // Speichere Ticket
            db.run(`INSERT INTO tickets (ticket_id, user_id, channel_id, status, created_at) VALUES (?, ?, ?, ?, ?)`,
                [ticketId, interaction.user.id, ticketChannel.id, 'open', new Date().toISOString()]
            );
            
            await interaction.reply({ 
                content: `✅ **Ticket erstellt:** ${ticketChannel}`, 
                ephemeral: true 
            });
            
            console.log(`🎫 Neues Ticket: ${ticketId} von ${interaction.user.username}`);
        }
        
        if (commandName === 'close-ticket') {
            // Überprüfe ob es ein Ticket-Channel ist
            const channel = interaction.channel;
            
            db.get(`SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'`, [channel.id], async (err, ticket) => {
                if (ticket) {
                    // Erstelle Transcript vor dem Schließen
                    const messages = await channel.messages.fetch({ limit: 100 });
                    const transcript = messages.reverse().map(msg => ({
                        username: msg.author.username,
                        content: msg.content,
                        timestamp: msg.createdAt.toISOString()
                    }));
                    
                    // Update Ticket in Datenbank
                    db.run(`UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE ticket_id = ?`,
                        [new Date().toISOString(), JSON.stringify(transcript), ticket.ticket_id]
                    );
                    
                    await interaction.reply({ content: '🔒 **Ticket wird geschlossen...** Transcript wurde gespeichert.' });
                    
                    // Lösche Channel nach 5 Sekunden
                    setTimeout(async () => {
                        await channel.delete();
                    }, 5000);
                    
                    console.log(`🔒 Ticket geschlossen: ${ticket.ticket_id}`);
                } else {
                    await interaction.reply({ 
                        content: '❌ Dies ist kein offenes Ticket oder du hast keine Berechtigung!', 
                        ephemeral: true 
                    });
                }
            });
        }
    } catch (error) {
        console.error('❌ Fehler bei Slash Command:', error);
        await interaction.reply({ 
            content: '❌ Ein Fehler ist aufgetreten!', 
            ephemeral: true 
        });
    }
});

// Error Handling
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutdown-Signal empfangen...');
    db.close();
    client.destroy();
    process.exit(0);
});

// Bot starten
client.login(CONFIG.BOT_TOKEN);

module.exports = { client, db };