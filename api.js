const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Datenbank-Verbindung
const db = new sqlite3.Database('./bot_database.sqlite');

// Hilfsfunktionen
function requireAuth(requiredRole = 'mod') {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Nicht authentifiziert' });
        }
        
        if (requiredRole === 'admin' && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
        }
        
        next();
    };
}

function logWebAction(userId, action, details) {
    db.run(`INSERT INTO web_logs (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)`,
        [userId, action, details, new Date().toISOString()]
    );
}

function sendCommandToBot(commandType, targetId, parameters = null) {
    return new Promise((resolve, reject) => {
        const parametersJson = parameters ? JSON.stringify(parameters) : null;
        
        db.run(`INSERT INTO bot_commands (command_type, target_id, parameters, status, created_at) 
                VALUES (?, ?, ?, 'pending', ?)`,
            [commandType, targetId, parametersJson, new Date().toISOString()],
            function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            }
        );
    });
}

function waitForCommandResult(commandId, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const checkStatus = () => {
            db.get(`SELECT * FROM bot_commands WHERE id = ?`, [commandId], (err, command) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (command.status === 'completed') {
                    resolve({ success: true, result: command.result });
                } else if (command.status === 'failed') {
                    resolve({ success: false, error: command.result });
                } else if (Date.now() - startTime > timeout) {
                    resolve({ success: false, error: 'Timeout - Bot hat nicht geantwortet' });
                } else {
                    setTimeout(checkStatus, 1000);
                }
            });
        };
        
        checkStatus();
    });
}

function getTimeAgo(timestamp) {
    if (!timestamp) return 'Unbekannt';
    
    const now = new Date();
    const time = new Date(timestamp);
    
    if (isNaN(time.getTime())) {
        return 'Unbekannt';
    }
    
    const diffInSeconds = Math.floor((now - time) / 1000);
    
    if (diffInSeconds < 60) {
        return 'vor wenigen Sekunden';
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `vor ${minutes} Minute${minutes !== 1 ? 'n' : ''}`;
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `vor ${hours} Stunde${hours !== 1 ? 'n' : ''}`;
    } else if (diffInSeconds < 604800) {
        const days = Math.floor(diffInSeconds / 86400);
        return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
    } else {
        return time.toLocaleDateString('de-DE');
    }
}

// ========================================
// DASHBOARD API
// ========================================

// Dashboard Aktivitäten laden
router.get('/dashboard/activities', requireAuth(), (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    
    const activitiesQuery = `
        SELECT 
            'message' as type,
            username as actor,
            channel_name as target,
            content as details,
            timestamp,
            'fas fa-comment' as icon,
            'info' as color
        FROM message_logs 
        WHERE user_id != 'SYSTEM' 
            AND content IS NOT NULL 
            AND content != ''
            AND timestamp IS NOT NULL
        
        UNION ALL
        
        SELECT 
            'ticket_created' as type,
            (SELECT username FROM users WHERE id = tickets.user_id) as actor,
            ticket_id as target,
            'Ticket erstellt' as details,
            created_at as timestamp,
            'fas fa-ticket-alt' as icon,
            'success' as color
        FROM tickets
        WHERE created_at IS NOT NULL
        
        UNION ALL
        
        SELECT 
            'user_verified' as type,
            username as actor,
            'Server' as target,
            'Erfolgreich verifiziert' as details,
            joined_at as timestamp,
            'fas fa-user-check' as icon,
            'success' as color
        FROM users 
        WHERE verified = 1 
            AND joined_at IS NOT NULL
        
        ORDER BY timestamp DESC
        LIMIT ?
    `;
    
    db.all(activitiesQuery, [limit], (err, activities) => {
        if (err) {
            console.error('Activities API error:', err);
            return res.status(500).json({ error: 'Fehler beim Laden der Aktivitäten' });
        }
        
        const formattedActivities = (activities || []).map(activity => {
            const timeAgo = getTimeAgo(activity.timestamp);
            
            let activityText = '';
            switch(activity.type) {
                case 'message':
                    const shortContent = activity.details && activity.details.length > 50 
                        ? activity.details.substring(0, 50) + '...' 
                        : activity.details || '[Keine Nachricht]';
                    activityText = `${activity.actor} schrieb in #${activity.target}: "${shortContent}"`;
                    break;
                case 'ticket_created':
                    activityText = `${activity.actor || 'Unbekannter Benutzer'} erstellte Ticket ${activity.target}`;
                    break;
                case 'user_verified':
                    activityText = `${activity.actor} wurde verifiziert`;
                    break;
                default:
                    activityText = `${activity.actor || 'Unbekannt'}: ${activity.details || 'Aktivität'}`;
            }
            
            return {
                type: activity.type,
                icon: activity.icon,
                color: activity.color,
                text: activityText,
                time: timeAgo,
                timestamp: activity.timestamp
            };
        });
        
        res.json({ activities: formattedActivities });
    });
});

// ========================================
// TICKET API - mit Bot-Kommunikation
// ========================================

// Ticket schließen API - VERBESSERT mit Bot-Kommunikation
router.post('/tickets/:ticketId/close', requireAuth(), async (req, res) => {
    const ticketId = req.params.ticketId;
    
    try {
        // Hole Ticket-Informationen
        db.get(`SELECT * FROM tickets WHERE ticket_id = ? AND status = 'open'`, [ticketId], async (err, ticket) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            if (!ticket) {
                return res.status(404).json({ error: 'Ticket nicht gefunden oder bereits geschlossen' });
            }
            
            try {
                // Erstelle Transcript
                db.all(`
                    SELECT * FROM message_logs 
                    WHERE channel_id = ? 
                    ORDER BY timestamp ASC
                `, [ticket.channel_id], async (err, messages) => {
                    if (err) {
                        console.error('Ticket messages error:', err);
                        messages = [];
                    }
                    
                    const transcript = JSON.stringify(messages || []);
                    
                    // Update Ticket in Datenbank
                    db.run(`UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE ticket_id = ?`,
                        [new Date().toISOString(), transcript, ticketId], async (err) => {
                            if (err) {
                                return res.status(500).json({ error: 'Fehler beim Schließen' });
                            }
                            
                            logWebAction(req.session.user.id, 'CLOSE_TICKET', `Ticket ${ticketId} über Web-Interface geschlossen`);
                            
                            try {
                                // Sende Command an Bot
                                const commandId = await sendCommandToBot('CLOSE_TICKET', ticketId, {
                                    closedBy: req.session.user.username,
                                    closedAt: new Date().toISOString()
                                });
                                
                                console.log(`📤 Command an Bot gesendet: ${commandId}`);
                                
                                // Warte auf Bot-Antwort (optional - für bessere UX)
                                const result = await waitForCommandResult(commandId, 10000);
                                
                                res.json({ 
                                    success: true, 
                                    message: 'Ticket erfolgreich geschlossen',
                                    transcript_available: true,
                                    bot_result: result
                                });
                                
                            } catch (botError) {
                                console.error('❌ Fehler bei Bot-Kommunikation:', botError);
                                
                                // Ticket wurde trotzdem geschlossen, nur Bot-Communication fehlgeschlagen
                                res.json({ 
                                    success: true, 
                                    message: 'Ticket geschlossen, aber Bot-Kommunikation fehlgeschlagen',
                                    transcript_available: true,
                                    warning: 'Discord-Channel könnte noch existieren'
                                });
                            }
                        });
                });
                
            } catch (error) {
                console.error('❌ Fehler beim Ticket schließen:', error);
                res.status(500).json({ error: 'Unerwarteter Fehler beim Schließen' });
            }
        });
    } catch (error) {
        console.error('❌ Fehler in Ticket-Close API:', error);
        res.status(500).json({ error: 'Serverfehler' });
    }
});

// Ticket Transcript herunterladen - VERBESSERT
router.get('/tickets/:ticketId/transcript', requireAuth(), (req, res) => {
    const ticketId = req.params.ticketId;
    
    db.get(`SELECT * FROM tickets WHERE ticket_id = ?`, [ticketId], (err, ticket) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket nicht gefunden' });
        }
        
        if (!ticket.transcript) {
            return res.status(404).json({ error: 'Kein Transcript verfügbar' });
        }
        
        try {
            const messages = JSON.parse(ticket.transcript);
            
            // Erstelle detailliertes Transcript
            let transcriptText = `14th Squad - Ticket Transcript\n`;
            transcriptText += `${'='.repeat(60)}\n`;
            transcriptText += `Ticket ID: ${ticket.ticket_id}\n`;
            transcriptText += `Benutzer: ${ticket.user_id}\n`;
            transcriptText += `Channel: ${ticket.channel_id}\n`;
            transcriptText += `Status: ${ticket.status}\n`;
            transcriptText += `Erstellt: ${new Date(ticket.created_at).toLocaleString('de-DE')}\n`;
            if (ticket.closed_at) {
                transcriptText += `Geschlossen: ${new Date(ticket.closed_at).toLocaleString('de-DE')}\n`;
            }
            transcriptText += `Nachrichten: ${messages.length}\n`;
            transcriptText += `${'='.repeat(60)}\n\n`;
            
            messages.forEach((msg, index) => {
                const timestamp = new Date(msg.timestamp).toLocaleString('de-DE');
                transcriptText += `[${index + 1}] [${timestamp}] ${msg.username}:\n`;
                transcriptText += `${msg.content || '[Keine Nachricht]'}\n`;
                
                if (msg.attachments) {
                    transcriptText += `    📎 Anhänge: ${msg.attachments}\n`;
                }
                
                if (msg.edited) {
                    transcriptText += `    ✏️ Nachricht wurde bearbeitet\n`;
                }
                
                if (msg.deleted) {
                    transcriptText += `    🗑️ Nachricht wurde gelöscht\n`;
                }
                
                transcriptText += '\n';
            });
            
            transcriptText += `\n${'='.repeat(60)}\n`;
            transcriptText += `Transcript erstellt: ${new Date().toLocaleString('de-DE')}\n`;
            transcriptText += `Erstellt von: ${req.session.user.username}\n`;
            transcriptText += `14th Squad Management System v1.1\n`;
            
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="ticket_${ticketId}_transcript_${Date.now()}.txt"`);
            res.send(transcriptText);
            
            logWebAction(req.session.user.id, 'DOWNLOAD_TRANSCRIPT', `Transcript für Ticket ${ticketId} heruntergeladen`);
            
        } catch (error) {
            console.error('Transcript parse error:', error);
            res.status(500).json({ error: 'Fehler beim Verarbeiten des Transcripts' });
        }
    });
});

// Ticket Daten exportieren - NEU
router.get('/tickets/:ticketId/export', requireAuth(), (req, res) => {
    const ticketId = req.params.ticketId;
    
    db.get(`
        SELECT t.*, u.username 
        FROM tickets t 
        LEFT JOIN users u ON t.user_id = u.id 
        WHERE t.ticket_id = ?
    `, [ticketId], (err, ticket) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket nicht gefunden' });
        }
        
        // Lade alle Nachrichten für dieses Ticket
        db.all(`
            SELECT * FROM message_logs 
            WHERE channel_id = ? 
            ORDER BY timestamp ASC
        `, [ticket.channel_id], (err, messages) => {
            if (err) {
                console.error('Messages error:', err);
                messages = [];
            }
            
            // Erstelle vollständige Export-Daten
            const exportData = {
                ticket_info: {
                    ticket_id: ticket.ticket_id,
                    user_id: ticket.user_id,
                    username: ticket.username,
                    channel_id: ticket.channel_id,
                    status: ticket.status,
                    created_at: ticket.created_at,
                    closed_at: ticket.closed_at
                },
                statistics: {
                    total_messages: messages.length,
                    messages_by_user: {},
                    duration_minutes: ticket.closed_at ? 
                        Math.round((new Date(ticket.closed_at) - new Date(ticket.created_at)) / (1000 * 60)) : 
                        Math.round((new Date() - new Date(ticket.created_at)) / (1000 * 60))
                },
                messages: messages,
                export_info: {
                    exported_by: req.session.user.username,
                    exported_at: new Date().toISOString(),
                    system_version: '14th Squad Management v1.1'
                }
            };
            
            // Berechne Nachrichten-Statistiken
            messages.forEach(msg => {
                if (exportData.statistics.messages_by_user[msg.username]) {
                    exportData.statistics.messages_by_user[msg.username]++;
                } else {
                    exportData.statistics.messages_by_user[msg.username] = 1;
                }
            });
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="ticket_${ticketId}_data_${Date.now()}.json"`);
            res.json(exportData);
            
            logWebAction(req.session.user.id, 'EXPORT_TICKET', `Ticket-Daten für ${ticketId} exportiert`);
        });
    });
});

// ========================================
// BENUTZER MANAGEMENT API
// ========================================

// Alle Discord-Benutzer laden
router.get('/users/discord', requireAuth(), (req, res) => {
    db.all(`
        SELECT 
            u.*,
            (SELECT COUNT(*) FROM message_logs WHERE user_id = u.id AND user_id != 'SYSTEM') as message_count,
            (SELECT COUNT(*) FROM tickets WHERE user_id = u.id) as ticket_count,
            (SELECT COUNT(*) FROM temp_channels WHERE owner_id = u.id) as voice_channel_count
        FROM users u 
        ORDER BY u.joined_at DESC
    `, (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Laden der Benutzer' });
        }
        
        res.json({ users: users || [] });
    });
});

// Discord Benutzer Statistiken
router.get('/users/discord/stats', requireAuth(), (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total_users,
            SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_users,
            SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) as pending_users,
            COUNT(DISTINCT personal_channel_id) as active_channels
        FROM users
    `, (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
        }
        
        res.json(stats[0] || { total_users: 0, verified_users: 0, pending_users: 0, active_channels: 0 });
    });
});

// Discord Benutzer manuell verifizieren
router.post('/users/discord/:userId/verify', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    
    db.run(`UPDATE users SET verified = 1 WHERE id = ?`, [userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler bei der Verifikation' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        logWebAction(req.session.user.id, 'VERIFY_USER', `Discord-Benutzer ${userId} manuell verifiziert`);
        
        res.json({ success: true, message: 'Benutzer erfolgreich verifiziert' });
    });
});

// Discord Benutzer Details
router.get('/users/discord/:userId/details', requireAuth(), (req, res) => {
    const userId = req.params.userId;
    
    // Benutzer-Grunddaten
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        // Statistiken sammeln
        db.all(`
            SELECT 
                (SELECT COUNT(*) FROM message_logs WHERE user_id = ? AND user_id != 'SYSTEM') as message_count,
                (SELECT COUNT(*) FROM tickets WHERE user_id = ?) as ticket_count,
                (SELECT COUNT(*) FROM temp_channels WHERE owner_id = ?) as voice_channel_count
        `, [userId, userId, userId], (err, stats) => {
            if (err) {
                console.error('User stats error:', err);
            }
            
            const userStats = stats[0] || { message_count: 0, ticket_count: 0, voice_channel_count: 0 };
            
            // Letzte Aktivitäten
            db.all(`
                SELECT 'message' as type, channel_name, timestamp FROM message_logs 
                WHERE user_id = ? AND user_id != 'SYSTEM'
                UNION ALL
                SELECT 'ticket' as type, ticket_id as channel_name, created_at as timestamp FROM tickets 
                WHERE user_id = ?
                ORDER BY timestamp DESC LIMIT 10
            `, [userId, userId], (err, activities) => {
                if (err) {
                    console.error('User activities error:', err);
                }
                
                res.json({
                    user,
                    stats: userStats,
                    activities: activities || []
                });
            });
        });
    });
});

// ========================================
// MODERATION API - mit Bot-Kommunikation
// ========================================

// Benutzer kicken
router.post('/users/discord/:userId/kick', requireAuth('admin'), async (req, res) => {
    const userId = req.params.userId;
    const { reason } = req.body;
    
    try {
        const commandId = await sendCommandToBot('KICK_USER', userId, { reason });
        const result = await waitForCommandResult(commandId);
        
        if (result.success) {
            logWebAction(req.session.user.id, 'KICK_USER', `Benutzer ${userId} gekickt: ${reason || 'Kein Grund angegeben'}`);
            res.json({ success: true, message: result.result });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('❌ Kick User Error:', error);
        res.status(500).json({ error: 'Fehler bei der Kommunikation mit dem Bot' });
    }
});

// Benutzer bannen
router.post('/users/discord/:userId/ban', requireAuth('admin'), async (req, res) => {
    const userId = req.params.userId;
    const { reason } = req.body;
    
    try {
        const commandId = await sendCommandToBot('BAN_USER', userId, { reason });
        const result = await waitForCommandResult(commandId);
        
        if (result.success) {
            logWebAction(req.session.user.id, 'BAN_USER', `Benutzer ${userId} gebannt: ${reason || 'Kein Grund angegeben'}`);
            res.json({ success: true, message: result.result });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('❌ Ban User Error:', error);
        res.status(500).json({ error: 'Fehler bei der Kommunikation mit dem Bot' });
    }
});

// Benutzer timeout
router.post('/users/discord/:userId/timeout', requireAuth('admin'), async (req, res) => {
    const userId = req.params.userId;
    const { reason, duration } = req.body;
    
    try {
        const commandId = await sendCommandToBot('TIMEOUT_USER', userId, { reason, duration });
        const result = await waitForCommandResult(commandId);
        
        if (result.success) {
            logWebAction(req.session.user.id, 'TIMEOUT_USER', `Benutzer ${userId} timeout: ${duration}s - ${reason || 'Kein Grund angegeben'}`);
            res.json({ success: true, message: result.result });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('❌ Timeout User Error:', error);
        res.status(500).json({ error: 'Fehler bei der Kommunikation mit dem Bot' });
    }
});

// Verifikation zurücksetzen
router.post('/users/discord/:userId/reset-verification', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    const newVerificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    db.run(`UPDATE users SET verified = 0, verification_code = ? WHERE id = ?`, 
        [newVerificationCode, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Zurücksetzen der Verifikation' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        logWebAction(req.session.user.id, 'RESET_VERIFICATION', 
            `Verifikation für Discord-Benutzer ${userId} zurückgesetzt`);
        
        res.json({ 
            success: true, 
            message: 'Verifikation zurückgesetzt',
            newVerificationCode: newVerificationCode
        });
    });
});

// Persönlichen Channel löschen
router.post('/users/discord/:userId/delete-channel', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    
    // Hole Channel-ID aus der Datenbank
    db.get(`SELECT personal_channel_id FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!user || !user.personal_channel_id) {
            return res.json({ success: true, message: 'Kein persönlicher Channel vorhanden' });
        }
        
        // Entferne Channel-Referenz aus Datenbank
        db.run(`UPDATE users SET personal_channel_id = NULL WHERE id = ?`, [userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Fehler beim Löschen der Channel-Referenz' });
            }
            
            logWebAction(req.session.user.id, 'DELETE_PERSONAL_CHANNEL', 
                `Persönlicher Channel für Discord-Benutzer ${userId} entfernt`);
            
            res.json({ 
                success: true, 
                message: 'Channel-Referenz entfernt (Discord-Channel muss manuell gelöscht werden)'
            });
        });
    });
});

// ========================================
// WEB-BENUTZER API
// ========================================

// Web-Benutzer Passwort zurücksetzen
router.post('/users/web/:userId/reset-password', requireAuth('admin'), async (req, res) => {
    const userId = req.params.userId;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(newPassword, 12);
        
        db.run(`UPDATE web_users SET password_hash = ? WHERE id = ?`, [passwordHash, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Fehler beim Passwort-Update' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Benutzer nicht gefunden' });
            }
            
            logWebAction(req.session.user.id, 'RESET_PASSWORD', `Passwort für Web-Benutzer ${userId} zurückgesetzt`);
            
            res.json({ success: true, message: 'Passwort erfolgreich zurückgesetzt' });
        });
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts' });
    }
});

// Unique Password regenerieren
router.post('/users/web/:userId/regenerate-unique', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    const newUniquePassword = crypto.randomBytes(6).toString('hex').toUpperCase();
    
    db.run(`UPDATE web_users SET unique_password = ? WHERE id = ?`, [newUniquePassword, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Update' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        logWebAction(req.session.user.id, 'REGENERATE_UNIQUE_PASSWORD', `Unique Password für Web-Benutzer ${userId} regeneriert`);
        
        res.json({ 
            success: true, 
            message: 'Unique Password regeneriert',
            uniquePassword: newUniquePassword
        });
    });
});

// Web-Benutzer Rolle ändern
router.post('/users/web/:userId/change-role', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    const { newRole } = req.body;
    
    if (!['admin', 'mod'].includes(newRole)) {
        return res.status(400).json({ error: 'Ungültige Rolle' });
    }
    
    // Verhindere dass der letzte Admin seine Rolle ändert
    if (newRole === 'mod') {
        db.get(`SELECT COUNT(*) as admin_count FROM web_users WHERE role = 'admin'`, (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            if (result.admin_count <= 1) {
                return res.status(400).json({ error: 'Mindestens ein Administrator muss vorhanden bleiben' });}
            
            updateUserRole();
        });
    } else {
        updateUserRole();
    }
    
    function updateUserRole() {
        db.run(`UPDATE web_users SET role = ? WHERE id = ?`, [newRole, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Fehler beim Ändern der Rolle' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Benutzer nicht gefunden' });
            }
            
            logWebAction(req.session.user.id, 'CHANGE_ROLE', 
                `Rolle für Web-Benutzer ${userId} zu ${newRole} geändert`);
            
            res.json({ 
                success: true, 
                message: `Rolle erfolgreich zu ${newRole} geändert`
            });
        });
    }
});

// Web-Benutzer löschen
router.delete('/users/web/:userId', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    
    // Verhindere Selbstlöschung
    if (parseInt(userId) === req.session.user.id) {
        return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
    }
    
    db.run(`DELETE FROM web_users WHERE id = ?`, [userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Löschen' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        logWebAction(req.session.user.id, 'DELETE_WEB_USER', `Web-Benutzer ${userId} gelöscht`);
        
        res.json({ success: true, message: 'Benutzer erfolgreich gelöscht' });
    });
});

// Web-Benutzer Aktivitäts-Logs
router.get('/users/web/:userId/logs', requireAuth('admin'), (req, res) => {
    const userId = req.params.userId;
    
    db.all(`
        SELECT * FROM web_logs 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 50
    `, [userId], (err, logs) => {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Laden der Logs' });
        }
        
        res.json({ logs: logs || [] });
    });
});

// Benutzer suchen (für Live-Search)
router.get('/users/search', requireAuth(), (req, res) => {
    const query = req.query.q;
    
    if (!query || query.length < 2) {
        return res.json({ discord: [], web: [] });
    }
    
    // Suche Discord-Benutzer
    db.all(`
        SELECT * FROM users 
        WHERE username LIKE ? OR id LIKE ? 
        LIMIT 10
    `, [`%${query}%`, `%${query}%`], (err, discordUsers) => {
        if (err) {
            console.error('Discord user search error:', err);
            discordUsers = [];
        }
        
        // Suche Web-Benutzer
        db.all(`
            SELECT id, username, role, created_at FROM web_users 
            WHERE username LIKE ? 
            LIMIT 10
        `, [`%${query}%`], (err, webUsers) => {
            if (err) {
                console.error('Web user search error:', err);
                webUsers = [];
            }
            
            res.json({
                discord: discordUsers || [],
                web: webUsers || []
            });
        });
    });
});

// ========================================
// NACHRICHTEN API
// ========================================

// Suche in Nachrichten (AJAX)
router.get('/messages/search', requireAuth(), (req, res) => {
    const query = req.query.q;
    
    if (!query || query.length < 2) {
        return res.json([]);
    }
    
    db.all(`
        SELECT * FROM message_logs 
        WHERE content LIKE ? OR username LIKE ? 
        ORDER BY timestamp DESC 
        LIMIT 20
    `, [`%${query}%`, `%${query}%`], (err, messages) => {
        if (err) {
            console.error('Message search error:', err);
            return res.json([]);
        }
        
        res.json(messages || []);
    });
});

// ========================================
// BOT STATUS & COMMUNICATION API
// ========================================

// Bot Status prüfen
router.get('/bot/status', requireAuth(), (req, res) => {
    // Prüfe letzte Bot-Aktivität
    db.get(`
        SELECT * FROM bot_commands 
        WHERE status IN ('completed', 'failed') 
        ORDER BY executed_at DESC 
        LIMIT 1
    `, (err, lastCommand) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        const now = new Date();
        const lastActivity = lastCommand ? new Date(lastCommand.executed_at) : null;
        const timeSinceLastActivity = lastActivity ? (now - lastActivity) / 1000 : null;
        
        // Bot gilt als online wenn letzte Aktivität < 60 Sekunden
        const botOnline = timeSinceLastActivity !== null && timeSinceLastActivity < 60;
        
        res.json({
            online: botOnline,
            last_activity: lastActivity,
            seconds_since_activity: timeSinceLastActivity,
            last_command: lastCommand ? {
                type: lastCommand.command_type,
                status: lastCommand.status,
                result: lastCommand.result
            } : null
        });
    });
});

// Pending Commands anzeigen
router.get('/bot/commands', requireAuth('admin'), (req, res) => {
    db.all(`
        SELECT * FROM bot_commands 
        ORDER BY created_at DESC 
        LIMIT 50
    `, (err, commands) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        res.json({ commands });
    });
});

// Command manuell als failed markieren (falls Bot hängt)
router.post('/bot/commands/:commandId/cancel', requireAuth('admin'), (req, res) => {
    const commandId = req.params.commandId;
    
    db.run(`UPDATE bot_commands SET status = 'cancelled', executed_at = ?, result = ? WHERE id = ? AND status = 'pending'`,
        [new Date().toISOString(), 'Manuell abgebrochen über Web-Interface', commandId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Command nicht gefunden oder bereits ausgeführt' });
            }
            
            logWebAction(req.session.user.id, 'CANCEL_COMMAND', `Command ${commandId} manuell abgebrochen`);
            res.json({ success: true, message: 'Command abgebrochen' });
        }
    );
});

// Test Command senden
router.post('/bot/test', requireAuth('admin'), async (req, res) => {
    try {
        const commandId = await sendCommandToBot('TEST', 'test-target', { message: 'Test vom Web-Interface' });
        
        logWebAction(req.session.user.id, 'TEST_COMMAND', `Test-Command ${commandId} gesendet`);
        
        res.json({ 
            success: true, 
            message: 'Test-Command gesendet',
            commandId: commandId
        });
    } catch (error) {
        console.error('❌ Test Command Error:', error);
        res.status(500).json({ error: 'Fehler beim Senden des Test-Commands' });
    }
});

// ========================================
// SYSTEM API ENDPUNKTE
// ========================================

// System Status
router.get('/system/status', requireAuth(), (req, res) => {
    db.all(`
        SELECT 
            (SELECT COUNT(*) FROM message_logs) as total_messages,
            (SELECT COUNT(*) FROM tickets) as total_tickets,
            (SELECT COUNT(*) FROM users) as total_discord_users,
            (SELECT COUNT(*) FROM web_users) as total_web_users,
            (SELECT COUNT(*) FROM temp_channels) as active_temp_channels,
            (SELECT COUNT(*) FROM web_logs) as total_web_logs
    `, (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Laden der System-Statistiken' });
        }
        
        const systemInfo = {
            stats: stats[0] || {},
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: '1.1.0',
            environment: process.env.NODE_ENV || 'development'
        };
        
        res.json(systemInfo);
    });
});

// Database Health Check
router.get('/system/health', requireAuth('admin'), (req, res) => {
    const healthChecks = [];
    
    // Teste Datenbank-Verbindung
    db.get(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'`, (err, result) => {
        if (err) {
            healthChecks.push({ name: 'database', status: 'error', message: err.message });
        } else {
            healthChecks.push({ name: 'database', status: 'ok', tables: result.count });
        }
        
        // Teste wichtige Tabellen
        const requiredTables = ['users', 'message_logs', 'tickets', 'web_users', 'web_logs', 'temp_channels', 'bot_commands'];
        let tablesChecked = 0;
        
        requiredTables.forEach(tableName => {
            db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, result) => {
                tablesChecked++;
                
                if (err) {
                    healthChecks.push({ name: tableName, status: 'error', message: err.message });
                } else {
                    healthChecks.push({ name: tableName, status: 'ok', rows: result.count });
                }
                
                if (tablesChecked === requiredTables.length) {
                    res.json({
                        status: healthChecks.every(check => check.status === 'ok') ? 'healthy' : 'unhealthy',
                        checks: healthChecks,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
    });
});

// Export Data (nur Admin)
router.get('/system/export/:type', requireAuth('admin'), (req, res) => {
    const exportType = req.params.type;
    
    logWebAction(req.session.user.id, 'EXPORT_DATA', `Daten-Export: ${exportType}`);
    
    switch (exportType) {
        case 'messages':
            db.all(`SELECT * FROM message_logs ORDER BY timestamp DESC`, (err, data) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Export' });
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="messages_export_${Date.now()}.json"`);
                res.json(data);
            });
            break;
            
        case 'users':
            db.all(`SELECT * FROM users ORDER BY joined_at DESC`, (err, data) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Export' });
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="users_export_${Date.now()}.json"`);
                res.json(data);
            });
            break;
            
        case 'tickets':
            db.all(`SELECT * FROM tickets ORDER BY created_at DESC`, (err, data) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Export' });
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="tickets_export_${Date.now()}.json"`);
                res.json(data);
            });
            break;
            
        case 'logs':
            db.all(`
                SELECT wl.*, wu.username 
                FROM web_logs wl 
                LEFT JOIN web_users wu ON wl.user_id = wu.id 
                ORDER BY wl.timestamp DESC
            `, (err, data) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Export' });
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="web_logs_export_${Date.now()}.json"`);
                res.json(data);
            });
            break;
            
        case 'bot_commands':
            db.all(`SELECT * FROM bot_commands ORDER BY created_at DESC`, (err, data) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Export' });
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="bot_commands_export_${Date.now()}.json"`);
                res.json(data);
            });
            break;
            
        default:
            res.status(400).json({ error: 'Unbekannter Export-Typ' });
    }
});

// Datenbankstatistiken
router.get('/system/database/stats', requireAuth('admin'), (req, res) => {
    const stats = {};
    const tables = ['users', 'message_logs', 'tickets', 'web_users', 'web_logs', 'temp_channels', 'bot_commands'];
    let completed = 0;
    
    tables.forEach(table => {
        db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, result) => {
            completed++;
            
            if (err) {
                stats[table] = { error: err.message };
            } else {
                stats[table] = { count: result.count };
            }
            
            if (completed === tables.length) {
                res.json({
                    success: true,
                    stats: stats,
                    timestamp: new Date().toISOString()
                });
            }
        });
    });
});

// Datenbankbereinigung (nur Admin)
router.post('/system/database/cleanup', requireAuth('admin'), (req, res) => {
    const { days = 30 } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffISO = cutoffDate.toISOString();
    
    let cleanupTasks = 0;
    let completedTasks = 0;
    const results = {};
    
    // Lösche alte Web-Logs
    cleanupTasks++;
    db.run(`DELETE FROM web_logs WHERE timestamp < ?`, [cutoffISO], function(err) {
        completedTasks++;
        results.web_logs = err ? { error: err.message } : { deleted: this.changes };
        
        if (completedTasks === cleanupTasks) {
            finishCleanup();
        }
    });
    
    // Lösche alte Bot-Commands
    cleanupTasks++;
    db.run(`DELETE FROM bot_commands WHERE created_at < ? AND status IN ('completed', 'failed', 'cancelled')`, [cutoffISO], function(err) {
        completedTasks++;
        results.bot_commands = err ? { error: err.message } : { deleted: this.changes };
        
        if (completedTasks === cleanupTasks) {
            finishCleanup();
        }
    });
    
    function finishCleanup() {
        logWebAction(req.session.user.id, 'DATABASE_CLEANUP', `Datenbankbereinigung durchgeführt: ${days} Tage`);
        
        res.json({
            success: true,
            message: `Datenbankbereinigung abgeschlossen (${days} Tage)`,
            results: results,
            timestamp: new Date().toISOString()
        });
    }
});

// ========================================
// ERROR HANDLING
// ========================================

// 404 Handler für API
router.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'API-Endpunkt nicht gefunden',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;