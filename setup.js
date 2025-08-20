const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const readline = require('readline');
const fs = require('fs');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const db = new sqlite3.Database('./bot_database.sqlite');

async function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function setup() {
    console.log('🚀 === 14th Squad Bot Setup v1.1 ===\n');

    console.log('Willkommen beim 14th Squad Management System!');
    console.log('Dieses Setup wird folgendes konfigurieren:');
    console.log('  • Datenbank-Tabellen erstellen');
    console.log('  • Discord Avatar Support hinzufügen');
    console.log('  • Performance-Optimierungen');
    console.log('  • Admin-Benutzer für Web-Interface');
    console.log('  • Discord Bot Konfiguration');
    console.log('  • 14th Squad spezifische Einstellungen\n');

    const proceed = await question('Möchtest du fortfahren? (j/n): ');
    if (proceed.toLowerCase() !== 'j' && proceed.toLowerCase() !== 'ja' && proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
        console.log('👋 Setup abgebrochen.');
        rl.close();
        db.close();
        return;
    }

    console.log('\n1. Erstelle erweiterte Datenbank-Tabellen...');

    db.serialize(async () => {
        console.log('   📊 Erstelle Haupttabellen...');

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            verification_code TEXT,
            verified BOOLEAN DEFAULT 0,
            joined_at DATETIME,
            personal_channel_id TEXT,
            avatar_hash TEXT,
            discriminator TEXT,
            last_seen DATETIME
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
            deleted BOOLEAN DEFAULT 0,
            user_avatar_hash TEXT,
            user_discriminator TEXT
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

        db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER,
            device_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES web_users (id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS bot_commands (
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
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS avatar_cache (
            user_id TEXT PRIMARY KEY,
            avatar_hash TEXT,
            discriminator TEXT,
            username TEXT,
            cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
        )`);

        console.log('   🔧 Erstelle Performance-Indizes...');

        db.run(`CREATE INDEX IF NOT EXISTS idx_users_avatar ON users(id, avatar_hash)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified, joined_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_message_logs_channel_time ON message_logs(channel_id, timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_message_logs_user ON message_logs(user_id, timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, created_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, created_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_bot_commands_status ON bot_commands(status, created_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_avatar_cache_expires ON avatar_cache(expires_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_web_logs_user_time ON web_logs(user_id, timestamp)`);

        console.log('   📈 Erstelle Datenbankviews...');

        db.run(`CREATE VIEW IF NOT EXISTS user_stats AS
        SELECT 
            u.id,
            u.username,
            u.avatar_hash,
            u.discriminator,
            u.verified,
            u.joined_at,
            u.last_seen,
            COUNT(DISTINCT ml.id) as message_count,
            COUNT(DISTINCT t.id) as ticket_count,
            COUNT(DISTINCT tc.channel_id) as temp_channel_count,
            MAX(ml.timestamp) as last_message_at
        FROM users u
        LEFT JOIN message_logs ml ON u.id = ml.user_id AND ml.user_id != 'SYSTEM'
        LEFT JOIN tickets t ON u.id = t.user_id
        LEFT JOIN temp_channels tc ON u.id = tc.owner_id
        GROUP BY u.id`);

        db.run(`CREATE VIEW IF NOT EXISTS activity_summary AS
        SELECT 
            'message' as activity_type,
            username as actor,
            channel_name as target,
            content as details,
            timestamp,
            'fas fa-comment' as icon,
            'info' as color,
            user_id
        FROM message_logs 
        WHERE user_id != 'SYSTEM' AND content IS NOT NULL AND content != ''

        UNION ALL

        SELECT 
            'ticket_created' as activity_type,
            (SELECT username FROM users WHERE id = tickets.user_id) as actor,
            ticket_id as target,
            'Ticket erstellt' as details,
            created_at as timestamp,
            'fas fa-ticket-alt' as icon,
            'success' as color,
            user_id
        FROM tickets

        UNION ALL

        SELECT 
            'user_verified' as activity_type,
            username as actor,
            'Server' as target,
            'Erfolgreich verifiziert' as details,
            joined_at as timestamp,
            'fas fa-user-check' as icon,
            'success' as color,
            id as user_id
        FROM users 
        WHERE verified = 1`);

        console.log('   🔄 Führe Datenbankschema-Updates durch...');

        const schemaUpdates = [
            'ALTER TABLE users ADD COLUMN avatar_hash TEXT',
            'ALTER TABLE users ADD COLUMN discriminator TEXT', 
            'ALTER TABLE users ADD COLUMN last_seen DATETIME',
            'ALTER TABLE message_logs ADD COLUMN user_avatar_hash TEXT',
            'ALTER TABLE message_logs ADD COLUMN user_discriminator TEXT',
            'ALTER TABLE bot_commands ADD COLUMN retry_count INTEGER DEFAULT 0',
            'ALTER TABLE bot_commands ADD COLUMN last_error TEXT'
        ];

        for (const update of schemaUpdates) {
            db.run(update, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.log(`   ⚠️  Schema Update: ${err.message}`);
                }
            });
        }

        console.log('   ✅ Datenbank-Schema erfolgreich erstellt!\n');

        console.log('2. Erstelle Admin-Benutzer für Web-Interface...');

        const adminUsername = await question('Admin Benutzername: ');

        if (!adminUsername || adminUsername.length < 3) {
            console.log('❌ Benutzername muss mindestens 3 Zeichen lang sein!');
            rl.close();
            db.close();
            return;
        }

        const adminPassword = await question('Admin Passwort (min. 6 Zeichen): ');

        if (!adminPassword || adminPassword.length < 6) {
            console.log('❌ Passwort muss mindestens 6 Zeichen lang sein!');
            rl.close();
            db.close();
            return;
        }

        const passwordHash = await bcrypt.hash(adminPassword, 12);
        const uniquePassword = crypto.randomBytes(6).toString('hex').toUpperCase();

        db.run(`INSERT OR REPLACE INTO web_users (username, password_hash, role, unique_password, created_at) 
                VALUES (?, ?, 'admin', ?, ?)`,
            [adminUsername, passwordHash, uniquePassword, new Date().toISOString()],
            function(err) {
                if (err) {
                    console.error('❌ Fehler beim Erstellen des Admin-Benutzers:', err);
                } else {
                    console.log('✅ Admin-Benutzer erfolgreich erstellt!');
                    console.log(`   📋 Login-Daten:`);
                    console.log(`   👤 Benutzername: ${adminUsername}`);
                    console.log(`   🔐 Passwort: ${adminPassword}`);
                    console.log(`   🔑 Unique Password: ${uniquePassword}`);
                    console.log('');
                    console.log('   ⚠️  WICHTIG: Speichere diese Daten sicher!');
                    console.log('   💾 Du findest das Unique Password auch später im Web-Interface unter "Benutzer"');
                    console.log('');

                    db.run(`INSERT INTO web_logs (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)`,
                        [this.lastID, 'SETUP_COMPLETED', 'Initiales Setup abgeschlossen', new Date().toISOString()]
                    );
                }

                setupConfig();
            }
        );
    });
}

async function setupConfig() {
    console.log('3. Bot-Konfiguration...');

    if (fs.existsSync('./config.js')) {
        console.log('⚠️  Eine config.js Datei existiert bereits!');
        console.log('📁 Aktuelle Konfiguration gefunden.\n');

        const overwrite = await question('Möchtest du die existierende config.js überschreiben? (j/n): ');

        if (overwrite.toLowerCase() !== 'j' && overwrite.toLowerCase() !== 'ja' && overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
            console.log('✅ Bestehende Konfiguration wird beibehalten.');
            console.log('📝 Du kannst die config.js manuell bearbeiten falls nötig.\n');

            await finalizeSetup();
            return;
        }

        console.log('🔄 Überschreibe bestehende config.js...\n');
    }

    console.log('🔧 Erstelle neue Konfiguration...\n');
    console.log('📋 Benötigte Discord-Informationen:');
    console.log('   • Bot Token (aus Discord Developer Portal)');
    console.log('   • Client ID (Application ID)');
    console.log('   • Guild ID (Server ID)');
    console.log('   • Kategorie IDs für Verification, Tickets, Temp Voice');
    console.log('   • Channel ID für "Join to Create"');
    console.log('   • Rollen IDs für Verified, Mod, Admin\n');

    const botToken = await question('Bot Token: ');

    if (!botToken || botToken.trim() === '') {
        console.log('❌ Bot Token ist erforderlich!');
        console.log('🔗 Hole deinen Token aus: https://discord.com/developers/applications');
        rl.close();
        db.close();
        return;
    }

    const clientId = await question('Client ID (Application ID): ');
    const guildId = await question('Guild ID (Server ID): ');

    console.log('\n📁 Kategorie-IDs:');
    const verificationCategory = await question('Verification Category ID: ');
    const ticketCategory = await question('Ticket Category ID: ');
    const tempVoiceCategory = await question('Temp Voice Category ID: ');

    console.log('\n🎤 Voice Channel:');
    const joinToCreateChannel = await question('Join to Create Channel ID: ');

    console.log('\n👥 Rollen-IDs:');
    const verifiedRole = await question('Verified Role ID: ');
    const modRole = await question('Moderator Role ID: ');
    const adminRole = await question('Admin Role ID: ');

    console.log('\n⚙️ Server-Einstellungen:');
    const webPort = await question('Web-Interface Port (Standard: 3000): ') || '3000';

    console.log('\n🖼️ Avatar-Einstellungen:');
    const enableAvatars = await question('Discord Avatar Support aktivieren? (j/n, Standard: j): ') || 'j';
    const avatarCacheTime = await question('Avatar Cache Zeit in Stunden (Standard: 24): ') || '24';

    const requiredFields = {
        'Bot Token': botToken,
        'Client ID': clientId,
        'Guild ID': guildId
    };

    let missingFields = [];
    for (const [field, value] of Object.entries(requiredFields)) {
        if (!value || value.trim() === '') {
            missingFields.push(field);
        }
    }

    if (missingFields.length > 0) {
        console.log(`\n❌ Folgende Felder sind erforderlich: ${missingFields.join(', ')}`);
        console.log('🔄 Bitte führe das Setup erneut aus.');
        rl.close();
        db.close();
        return;
    }

    const configContent = `

module.exports = {

    BOT_TOKEN: '${botToken.trim()}',
    CLIENT_ID: '${clientId.trim()}',
    GUILD_ID: '${guildId.trim()}',

    VERIFICATION_CATEGORY: '${verificationCategory.trim()}',
    TICKET_CATEGORY: '${ticketCategory.trim()}',
    TEMP_VOICE_CATEGORY: '${tempVoiceCategory.trim()}',

    JOIN_TO_CREATE_CHANNEL: '${joinToCreateChannel.trim()}',

    VERIFIED_ROLE: '${verifiedRole.trim()}',
    MOD_ROLE: '${modRole.trim()}',
    ADMIN_ROLE: '${adminRole.trim()}',

    WEB_PORT: ${parseInt(webPort) || 3000},

    ENABLE_AVATARS: ${enableAvatars.toLowerCase().startsWith('j') ? 'true' : 'false'},
    AVATAR_CACHE_HOURS: ${parseInt(avatarCacheTime) || 24},
    AVATAR_DEFAULT_SIZE: 128,
    AVATAR_BATCH_SIZE: 50,

    COMMAND_TIMEOUT: 30000,
    AVATAR_SYNC_INTERVAL: 6 * 60 * 60 * 1000, 
    SESSION_CLEANUP_INTERVAL: 60 * 60 * 1000, 

    SERVER_NAME: '14th Squad',
    PRIMARY_COLOR: '#ff0066',
    SECONDARY_COLOR: '#cc0052',
    VERSION: '1.1.0',

    DEBUG_MODE: false,
    LOG_AVATAR_OPERATIONS: true,
    LOG_COMMAND_OPERATIONS: true
};`;

    try {
        require('fs').writeFileSync('./config.js', configContent);
        console.log('\n✅ Konfiguration erfolgreich gespeichert!');
        console.log('📁 Datei: config.js');
    } catch (error) {
        console.log('\n❌ Fehler beim Speichern der config.js:', error.message);
        rl.close();
        db.close();
        return;
    }

    await finalizeSetup();
}

async function finalizeSetup() {
    console.log('\n🔧 Führe abschließende Optimierungen durch...');

    db.run('PRAGMA journal_mode=WAL;');
    db.run('PRAGMA synchronous=NORMAL;');
    db.run('PRAGMA cache_size=10000;');
    db.run('PRAGMA temp_store=memory;');

    db.run(`DELETE FROM user_sessions WHERE expires_at < datetime('now')`);

    db.run(`DELETE FROM avatar_cache WHERE expires_at < datetime('now')`);

    console.log('\n=== Setup erfolgreich abgeschlossen! ===');
    console.log('\n📋 Zusammenfassung:');
    console.log('   ✅ Erweiterte Datenbank erstellt');
    console.log('   ✅ Discord Avatar Support aktiviert');
    console.log('   ✅ Performance-Optimierungen angewendet');
    console.log('   ✅ Admin-Benutzer erstellt');
    console.log('   ✅ Bot-Konfiguration gespeichert');

    console.log('\n🚀 Nächste Schritte:');
    console.log('   1. npm install               - Dependencies installieren');
    console.log('   2. npm start                 - Bot und Web-Interface starten');
    console.log('   3. http://localhost:3000     - Web-Interface öffnen');

    console.log('\n🆕 Neue Features in v1.1:');
    console.log('   🖼️  Discord Avatar Support');
    console.log('   ⚡ Verbesserte Performance');
    console.log('   🔒 Erweiterte Session-Verwaltung');
    console.log('   📊 Datenbankviews für Statistiken');
    console.log('   🔄 Bot-Server Kommunikation');

    console.log('\n💡 Tipps:');
    console.log('   • Überprüfe alle Discord-IDs in der config.js');
    console.log('   • Stelle sicher dass der Bot die nötigen Rechte hat');
    console.log('   • Teste zuerst das Verifikationssystem');
    console.log('   • Avatar-Synchronisation erfolgt automatisch alle 6 Stunden');

    console.log('\n🔍 Bei Problemen:');
    console.log('   node setup.js                - Setup erneut ausführen');
    console.log('   npm run check-password       - Admin-Passwort anzeigen');
    console.log('   http://localhost:3000/health - System-Status prüfen');

    console.log('\n🛠️ Verwaltungsbefehle:');
    console.log('   GET  /admin/avatar-stats     - Avatar-Statistiken');
    console.log('   POST /admin/sync-avatars     - Manuelle Avatar-Sync');
    console.log('   GET  /admin/system-status    - Ausführlicher System-Status');

    rl.close();
    db.close();
}

async function cleanupDatabase() {
    console.log('🧹 Bereinige Datenbank...');

    db.run(`DELETE FROM user_sessions WHERE expires_at < datetime('now')`);

    db.run(`DELETE FROM avatar_cache WHERE expires_at < datetime('now')`);

    db.run(`DELETE FROM bot_commands 
            WHERE status IN ('completed', 'failed') 
            AND created_at < datetime('now', '-7 days')`);

    db.run(`DELETE FROM web_logs 
            WHERE timestamp < datetime('now', '-30 days')`);

    console.log('✅ Datenbankbereinigung abgeschlossen');
}

async function showAdminPassword() {
    console.log('🔑 Admin-Passwort Information:\n');

    db.get(`SELECT username, unique_password, created_at FROM web_users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`, 
        (err, admin) => {
            if (err || !admin) {
                console.log('❌ Kein Admin-Benutzer gefunden!');
                console.log('💡 Führe das Setup erneut aus: node setup.js');
            } else {
                console.log(`👤 Admin-Benutzername: ${admin.username}`);
                console.log(`🔑 Unique Password: ${admin.unique_password}`);
                console.log(`📅 Erstellt: ${new Date(admin.created_at).toLocaleString('de-DE')}`);
                console.log('\n💾 Diese Informationen findest du auch im Web-Interface unter "Benutzer"');
            }

            db.close();
        }
    );
}

const args = process.argv.slice(2);
if (args[0] === 'cleanup') {
    cleanupDatabase();
} else if (args[0] === 'show-password') {
    showAdminPassword();
} else {
    setup().catch(console.error);
}