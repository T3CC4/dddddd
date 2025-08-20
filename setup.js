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
    console.log('🚀 === 14th Squad Bot Setup ===\n');
    
    // Begrüßung und Info
    console.log('Willkommen beim 14th Squad Management System!');
    console.log('Dieses Setup wird folgendes konfigurieren:');
    console.log('  • Datenbank-Tabellen erstellen');
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
    
    console.log('\n1. Erstelle Datenbank-Tabellen...');
    
    console.log('1. Erstelle Datenbank-Tabellen...');
    
    // Erstelle alle Tabellen
    db.serialize(async () => {
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

        db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER,
            device_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES web_users (id) ON DELETE CASCADE
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)`);
        
        console.log('✅ Datenbank-Tabellen erstellt.\n');
        
        console.log('2. Erstelle Admin-Benutzer für Web-Interface...');
        
        const adminUsername = await question('Admin Benutzername: ');
        const adminPassword = await question('Admin Passwort: ');
        
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
                    console.log(`   🔑 Unique Password: ${uniquePassword}`);
                    console.log('');
                    console.log('   ⚠️  WICHTIG: Speichere das Unique Password sicher!');
                    console.log('   💾 Du findest es auch in der Datenbank oder im Web-Interface unter "Benutzer"');
                    console.log('');
                }
                
                setupConfig();
            }
        );
    });
}

async function setupConfig() {
    console.log('3. Bot-Konfiguration...');
    
    // Überprüfe ob config.js bereits existiert
    if (fs.existsSync('./config.js')) {
        console.log('⚠️  Eine config.js Datei existiert bereits!');
        console.log('📁 Aktuelle Konfiguration gefunden.\n');
        
        const overwrite = await question('Möchtest du die existierende config.js überschreiben? (j/n): ');
        
        if (overwrite.toLowerCase() !== 'j' && overwrite.toLowerCase() !== 'ja' && overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
            console.log('✅ Bestehende Konfiguration wird beibehalten.');
            console.log('📝 Du kannst die config.js manuell bearbeiten falls nötig.\n');
            
            console.log('=== Setup abgeschlossen! ===');
            console.log('\nNächste Schritte:');
            console.log('1. npm install - Abhängigkeiten installieren (falls noch nicht gemacht)');
            console.log('2. config.js überprüfen - Stelle sicher dass alle IDs korrekt sind');
            console.log('3. npm start - Bot und Web-Interface starten');
            console.log('4. Web-Interface: http://localhost:3000');
            
            rl.close();
            db.close();
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
    
    // Validierung
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
    
    // Erstelle Config-Datei
    const configContent = `// 14th Squad Bot Konfiguration
// Generiert am: ${new Date().toLocaleString('de-DE')}

module.exports = {
    // === Discord Bot Konfiguration ===
    BOT_TOKEN: '${botToken.trim()}',
    CLIENT_ID: '${clientId.trim()}',
    GUILD_ID: '${guildId.trim()}',
    
    // === Kategorie IDs ===
    VERIFICATION_CATEGORY: '${verificationCategory.trim()}',
    TICKET_CATEGORY: '${ticketCategory.trim()}',
    TEMP_VOICE_CATEGORY: '${tempVoiceCategory.trim()}',
    
    // === Channel IDs ===
    JOIN_TO_CREATE_CHANNEL: '${joinToCreateChannel.trim()}',
    
    // === Rollen IDs ===
    VERIFIED_ROLE: '${verifiedRole.trim()}',
    MOD_ROLE: '${modRole.trim()}',
    ADMIN_ROLE: '${adminRole.trim()}',
    
    // === Web-Interface ===
    WEB_PORT: ${parseInt(webPort) || 3000},
    
    // === 14th Squad Branding ===
    SERVER_NAME: '14th Squad',
    PRIMARY_COLOR: '#ff0066',
    SECONDARY_COLOR: '#cc0052'
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
    
    console.log('\n=== Setup abgeschlossen! ===');
    console.log('\n📋 Zusammenfassung:');
    console.log(`   🤖 Bot Token: ${botToken.substring(0, 10)}...`);
    console.log(`   🏠 Server: ${guildId}`);
    console.log(`   🌐 Web-Port: ${webPort}`);
    
    console.log('\n🚀 Nächste Schritte:');
    console.log('   1. npm install               - Dependencies installieren');
    console.log('   2. npm start                 - Bot und Web-Interface starten');
    console.log('   3. http://localhost:' + webPort + '       - Web-Interface öffnen');
    
    console.log('\n💡 Tipps:');
    console.log('   • Überprüfe alle Discord-IDs in der config.js');
    console.log('   • Stelle sicher dass der Bot die nötigen Rechte hat');
    console.log('   • Teste zuerst das Verifikationssystem');
    
    console.log('\n🔍 Bei Problemen:');
    console.log('   npm run check-password       - Admin-Passwort anzeigen');
    console.log('   node setup.js                - Setup erneut ausführen');
    
    rl.close();
    db.close();
}

setup().catch(console.error);