const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Discord Bot Management System wird gestartet...\n');

// Überprüfe ob config.js existiert
if (!fs.existsSync('./config.js')) {
    console.error('❌ config.js nicht gefunden!');
    console.log('📋 Bitte führe zuerst das Setup aus:');
    console.log('   node setup.js');
    process.exit(1);
}

// Lade Konfiguration
try {
    const CONFIG = require('./config.js');
    
    // Validiere wichtige Konfigurationen
    if (!CONFIG.BOT_TOKEN || CONFIG.BOT_TOKEN.includes('DEIN_BOT_TOKEN')) {
        console.error('❌ Bot Token nicht konfiguriert!');
        console.log('📝 Bitte bearbeite config.js und trage deinen Bot Token ein.');
        process.exit(1);
    }
    
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes('DEINE_CLIENT_ID')) {
        console.error('❌ Client ID nicht konfiguriert!');
        console.log('📝 Bitte bearbeite config.js und trage deine Client ID ein.');
        process.exit(1);
    }
    
    console.log('✅ Konfiguration geladen');
    console.log(`📡 Bot wird auf Server ${CONFIG.GUILD_ID} gestartet`);
    console.log(`🌐 Web-Interface läuft auf Port ${CONFIG.WEB_PORT || 3000}\n`);
    
} catch (error) {
    console.error('❌ Fehler beim Laden der Konfiguration:', error.message);
    process.exit(1);
}

// Überprüfe ob node_modules existiert
if (!fs.existsSync('./node_modules')) {
    console.error('❌ node_modules nicht gefunden!');
    console.log('📦 Bitte installiere zuerst die Abhängigkeiten:');
    console.log('   npm install');
    process.exit(1);
}

// Starte Bot und Web-Server
const botProcess = spawn('node', ['bot.js'], { stdio: 'pipe' });
const webProcess = spawn('node', ['server.js'], { stdio: 'pipe' });

// Bot Ausgaben
botProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
        console.log(`🤖 BOT: ${output}`);
    }
});

botProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
        console.error(`🤖 BOT ERROR: ${output}`);
    }
});

// Web-Server Ausgaben
webProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
        console.log(`🌐 WEB: ${output}`);
    }
});

webProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
        console.error(`🌐 WEB ERROR: ${output}`);
    }
});

// Process Event Handlers
botProcess.on('close', (code) => {
    console.log(`🤖 Bot-Prozess beendet mit Code ${code}`);
    if (code !== 0) {
        console.error('❌ Bot ist unerwartet beendet worden!');
    }
});

webProcess.on('close', (code) => {
    console.log(`🌐 Web-Server-Prozess beendet mit Code ${code}`);
    if (code !== 0) {
        console.error('❌ Web-Server ist unerwartet beendet worden!');
    }
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutdown-Signal empfangen. Beende Prozesse...');
    
    botProcess.kill('SIGTERM');
    webProcess.kill('SIGTERM');
    
    setTimeout(() => {
        console.log('✅ Alle Prozesse beendet. Auf Wiedersehen!');
        process.exit(0);
    }, 2000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Terminate-Signal empfangen. Beende Prozesse...');
    botProcess.kill('SIGTERM');
    webProcess.kill('SIGTERM');
    process.exit(0);
});

// Unhandled Rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

console.log('✨ System gestartet! Drücke Ctrl+C zum Beenden.');
console.log('🔗 Web-Interface: http://localhost:' + (process.env.PORT || 3000));
console.log('📊 Logs werden hier angezeigt...\n');