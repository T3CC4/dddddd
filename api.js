const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Import centralized utilities
const {
    setDatabase,
    getTimeAgo,
    logWebAction,
    sendCommandToBot,
    waitForCommandResult,
    requireAuth,
    queryHelpers,
    responseHelpers,
    validationHelpers,
    dbHelpers
} = require('./utils/backend');

// Get database reference from server.js
const db = new sqlite3.Database('./bot_database.sqlite');
setDatabase(db);

// Dashboard Activities API
router.get('/dashboard/activities', requireAuth(), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50 activities
        
        const activitiesQueryData = queryHelpers.getActivitiesQuery(limit);
        const activities = await dbHelpers.query(activitiesQueryData.query, activitiesQueryData.params);
        
        const formattedActivities = queryHelpers.formatActivities(activities);
        
        responseHelpers.success(res, { activities: formattedActivities });
    } catch (error) {
        console.error('Activities API error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Aktivitäten');
    }
});

// Ticket Management APIs
router.post('/tickets/:ticketId/close', requireAuth(), async (req, res) => {
    const ticketId = validationHelpers.sanitizeInput(req.params.ticketId);
    
    if (!validationHelpers.isValidId(ticketId)) {
        return responseHelpers.error(res, 'Ungültige Ticket-ID', 400);
    }

    try {
        const ticket = await dbHelpers.get(`SELECT * FROM tickets WHERE ticket_id = ? AND status = 'open'`, [ticketId]);
        
        if (!ticket) {
            return responseHelpers.notFound(res, 'Ticket');
        }

        // Get ticket messages for transcript
        const messages = await dbHelpers.query(`
            SELECT * FROM message_logs 
            WHERE channel_id = ? 
            ORDER BY timestamp ASC
        `, [ticket.channel_id]);

        const transcript = JSON.stringify(messages || []);
        const closedAt = new Date().toISOString();

        // Update ticket status
        await dbHelpers.run(`
            UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE ticket_id = ?
        `, [closedAt, transcript, ticketId]);

        logWebAction(req.session.user.id, 'CLOSE_TICKET', `Ticket ${ticketId} über Web-Interface geschlossen`);

        try {
            // Send command to bot
            const commandId = await sendCommandToBot('CLOSE_TICKET', ticketId, {
                closedBy: req.session.user.username,
                closedAt: closedAt
            });

            console.log(`📤 Command an Bot gesendet: ${commandId}`);

            const result = await waitForCommandResult(commandId, 10000);

            responseHelpers.success(res, {
                transcript_available: true,
                bot_result: result
            }, 'Ticket erfolgreich geschlossen');

        } catch (botError) {
            console.error('❌ Fehler bei Bot-Kommunikation:', botError);

            responseHelpers.success(res, {
                transcript_available: true,
                warning: 'Discord-Channel könnte noch existieren'
            }, 'Ticket geschlossen, aber Bot-Kommunikation fehlgeschlagen');
        }

    } catch (error) {
        console.error('❌ Fehler beim Ticket schließen:', error);
        responseHelpers.error(res, 'Unerwarteter Fehler beim Schließen');
    }
});

router.get('/tickets/:ticketId/details', requireAuth(), async (req, res) => {
    const ticketId = validationHelpers.sanitizeInput(req.params.ticketId);
    
    if (!validationHelpers.isValidId(ticketId)) {
        return responseHelpers.error(res, 'Ungültige Ticket-ID', 400);
    }

    try {
        const ticket = await dbHelpers.get(`SELECT * FROM tickets WHERE ticket_id = ?`, [ticketId]);
        
        if (!ticket) {
            return responseHelpers.notFound(res, 'Ticket');
        }

        const user = await dbHelpers.get(`SELECT * FROM users WHERE id = ?`, [ticket.user_id]);
        
        const stats = await dbHelpers.get(`
            SELECT 
                COUNT(*) as message_count,
                COUNT(DISTINCT user_id) as participant_count,
                COUNT(CASE WHEN attachments IS NOT NULL AND attachments != '' THEN 1 END) as attachment_count
            FROM message_logs 
            WHERE channel_id = ?
        `, [ticket.channel_id]);

        responseHelpers.success(res, {
            ticket: {
                ...ticket,
                user: user || null,
                stats: stats || { message_count: 0, participant_count: 0, attachment_count: 0 }
            }
        });

    } catch (error) {
        console.error('Ticket details error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Ticket-Details');
    }
});

router.get('/tickets/:ticketId/transcript', requireAuth(), async (req, res) => {
    const ticketId = validationHelpers.sanitizeInput(req.params.ticketId);
    
    if (!validationHelpers.isValidId(ticketId)) {
        return responseHelpers.error(res, 'Ungültige Ticket-ID', 400);
    }

    try {
        const ticket = await dbHelpers.get(`SELECT * FROM tickets WHERE ticket_id = ?`, [ticketId]);
        
        if (!ticket) {
            return responseHelpers.notFound(res, 'Ticket');
        }

        let messages = await dbHelpers.query(`
            SELECT ml.*, u.username, u.avatar_hash, u.discriminator
            FROM message_logs ml
            LEFT JOIN users u ON ml.user_id = u.id
            WHERE ml.channel_id = ? 
            ORDER BY ml.timestamp ASC
        `, [ticket.channel_id]);

        // Fallback to stored transcript
        if (messages.length === 0 && ticket.transcript) {
            try {
                messages = JSON.parse(ticket.transcript);
            } catch (parseError) {
                console.error('Transcript parse error:', parseError);
                messages = [];
            }
        }

        // Generate transcript text
        let transcriptText = `14th Squad - Ticket Transcript\n`;
        transcriptText += `${'='.repeat(60)}\n`;
        transcriptText += `Ticket ID: ${ticket.ticket_id}\n`;
        transcriptText += `Status: ${ticket.status}\n`;
        transcriptText += `Erstellt: ${new Date(ticket.created_at).toLocaleString('de-DE')}\n`;
        if (ticket.closed_at) {
            transcriptText += `Geschlossen: ${new Date(ticket.closed_at).toLocaleString('de-DE')}\n`;
        }
        transcriptText += `Nachrichten: ${messages.length}\n`;
        transcriptText += `${'='.repeat(60)}\n\n`;

        messages.forEach((msg, index) => {
            const timestamp = new Date(msg.timestamp).toLocaleString('de-DE');
            const username = msg.username || 'Unbekannt';
            const content = msg.content || '[Keine Nachricht]';

            transcriptText += `[${index + 1}] [${timestamp}] ${username}:\n`;
            transcriptText += `${content}\n`;

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
        console.error('Transcript download error:', error);
        responseHelpers.error(res, 'Fehler beim Generieren des Transcripts');
    }
});

router.get('/tickets/:ticketId/export', requireAuth(), async (req, res) => {
    const ticketId = validationHelpers.sanitizeInput(req.params.ticketId);
    
    if (!validationHelpers.isValidId(ticketId)) {
        return responseHelpers.error(res, 'Ungültige Ticket-ID', 400);
    }

    try {
        const ticket = await dbHelpers.get(`
            SELECT t.*, u.username, u.avatar_hash, u.discriminator
            FROM tickets t 
            LEFT JOIN users u ON t.user_id = u.id 
            WHERE t.ticket_id = ?
        `, [ticketId]);

        if (!ticket) {
            return responseHelpers.notFound(res, 'Ticket');
        }

        const messages = await dbHelpers.query(`
            SELECT ml.*, u.username, u.avatar_hash, u.discriminator
            FROM message_logs ml
            LEFT JOIN users u ON ml.user_id = u.id
            WHERE ml.channel_id = ? 
            ORDER BY ml.timestamp ASC
        `, [ticket.channel_id]);

        const messagesByUser = {};
        const attachmentCount = messages.filter(m => m.attachments && m.attachments.trim() !== '').length;
        const participantCount = new Set(messages.map(m => m.username)).size;

        messages.forEach(msg => {
            if (messagesByUser[msg.username]) {
                messagesByUser[msg.username]++;
            } else {
                messagesByUser[msg.username] = 1;
            }
        });

        const duration = ticket.closed_at ? 
            Math.round((new Date(ticket.closed_at) - new Date(ticket.created_at)) / (1000 * 60)) : 
            Math.round((new Date() - new Date(ticket.created_at)) / (1000 * 60));

        const exportData = {
            ticket_info: {
                ticket_id: ticket.ticket_id,
                user_id: ticket.user_id,
                username: ticket.username,
                channel_id: ticket.channel_id,
                status: ticket.status,
                created_at: ticket.created_at,
                closed_at: ticket.closed_at,
                user_avatar: ticket.avatar_hash,
                user_discriminator: ticket.discriminator
            },
            statistics: {
                total_messages: messages.length,
                participant_count: participantCount,
                attachment_count: attachmentCount,
                duration_minutes: duration,
                messages_by_user: messagesByUser
            },
            messages: messages.map(msg => ({
                id: msg.id,
                message_id: msg.message_id,
                user_id: msg.user_id,
                username: msg.username,
                content: msg.content,
                timestamp: msg.timestamp,
                attachments: msg.attachments,
                edited: !!msg.edited,
                deleted: !!msg.deleted,
                avatar_hash: msg.avatar_hash,
                discriminator: msg.discriminator
            })),
            export_info: {
                exported_by: req.session.user.username,
                exported_at: new Date().toISOString(),
                system_version: '14th Squad Management v1.1'
            }
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="ticket_${ticketId}_data_${Date.now()}.json"`);
        res.json(exportData);

        logWebAction(req.session.user.id, 'EXPORT_TICKET', `Ticket-Daten für ${ticketId} exportiert`);

    } catch (error) {
        console.error('Ticket export error:', error);
        responseHelpers.error(res, 'Fehler beim Exportieren der Ticket-Daten');
    }
});

// Discord User APIs
router.get('/discord/users/:userId', requireAuth(), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    
    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const user = await dbHelpers.get(`SELECT * FROM users WHERE id = ?`, [userId]);

        if (user) {
            responseHelpers.success(res, {
                user: {
                    id: user.id,
                    username: user.username,
                    avatar: user.avatar_hash || null, 
                    discriminator: user.discriminator || null, 
                    verified: user.verified
                }
            });
        } else {
            responseHelpers.notFound(res, 'User');
        }
    } catch (error) {
        console.error('Discord user lookup error:', error);
        responseHelpers.error(res, 'Datenbankfehler');
    }
});

router.post('/discord/users/batch', requireAuth(), async (req, res) => {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
        return responseHelpers.error(res, 'Ungültige User IDs', 400);
    }

    try {
        const limitedUserIds = userIds.slice(0, 50);
        const placeholders = limitedUserIds.map(() => '?').join(',');

        const users = await dbHelpers.query(`SELECT * FROM users WHERE id IN (${placeholders})`, limitedUserIds);

        const userData = users.map(user => ({
            id: user.id,
            username: user.username,
            avatar: user.avatar_hash || null,
            discriminator: user.discriminator || null,
            verified: user.verified
        }));

        responseHelpers.success(res, { users: userData });
    } catch (error) {
        console.error('Batch user lookup error:', error);
        responseHelpers.error(res, 'Datenbankfehler');
    }
});

// User Management APIs
router.get('/users/discord', requireAuth(), async (req, res) => {
    try {
        const users = await dbHelpers.query(`
            SELECT 
                u.*,
                (SELECT COUNT(*) FROM message_logs WHERE user_id = u.id AND user_id != 'SYSTEM') as message_count,
                (SELECT COUNT(*) FROM tickets WHERE user_id = u.id) as ticket_count,
                (SELECT COUNT(*) FROM temp_channels WHERE owner_id = u.id) as voice_channel_count
            FROM users u 
            ORDER BY u.joined_at DESC
        `);

        responseHelpers.success(res, { users: users || [] });
    } catch (error) {
        console.error('Discord users error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Benutzer');
    }
});

router.get('/users/discord/stats', requireAuth(), async (req, res) => {
    try {
        const stats = await dbHelpers.get(`
            SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_users,
                SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) as pending_users,
                COUNT(DISTINCT personal_channel_id) as active_channels
            FROM users
        `);

        responseHelpers.success(res, stats || { total_users: 0, verified_users: 0, pending_users: 0, active_channels: 0 });
    } catch (error) {
        console.error('Discord stats error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Statistiken');
    }
});

router.post('/users/discord/:userId/verify', requireAuth('admin'), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    
    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const result = await dbHelpers.run(`UPDATE users SET verified = 1 WHERE id = ?`, [userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        logWebAction(req.session.user.id, 'VERIFY_USER', `Discord-Benutzer ${userId} manuell verifiziert`);

        responseHelpers.success(res, null, 'Benutzer erfolgreich verifiziert');
    } catch (error) {
        console.error('User verification error:', error);
        responseHelpers.error(res, 'Fehler bei der Verifikation');
    }
});

router.get('/users/discord/:userId/details', requireAuth(), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    
    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const user = await dbHelpers.get(`SELECT * FROM users WHERE id = ?`, [userId]);
        
        if (!user) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        const stats = await dbHelpers.get(`
            SELECT 
                (SELECT COUNT(*) FROM message_logs WHERE user_id = ? AND user_id != 'SYSTEM') as message_count,
                (SELECT COUNT(*) FROM tickets WHERE user_id = ?) as ticket_count,
                (SELECT COUNT(*) FROM temp_channels WHERE owner_id = ?) as voice_channel_count
        `, [userId, userId, userId]);

        const activities = await dbHelpers.query(`
            SELECT 'message' as type, channel_name, timestamp FROM message_logs 
            WHERE user_id = ? AND user_id != 'SYSTEM'
            UNION ALL
            SELECT 'ticket' as type, ticket_id as channel_name, created_at as timestamp FROM tickets 
            WHERE user_id = ?
            ORDER BY timestamp DESC LIMIT 10
        `, [userId, userId]);

        responseHelpers.success(res, {
            user,
            stats: stats || { message_count: 0, ticket_count: 0, voice_channel_count: 0 },
            activities: activities || []
        });

    } catch (error) {
        console.error('User details error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Benutzer-Details');
    }
});

// Moderation APIs
router.post('/users/discord/:userId/kick', requireAuth('admin'), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    const { reason } = req.body;

    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const commandId = await sendCommandToBot('KICK_USER', userId, { reason });
        const result = await waitForCommandResult(commandId);

        if (result.success) {
            logWebAction(req.session.user.id, 'KICK_USER', `Benutzer ${userId} gekickt: ${reason || 'Kein Grund angegeben'}`);
            responseHelpers.success(res, null, result.result);
        } else {
            responseHelpers.error(res, result.error, 400);
        }
    } catch (error) {
        console.error('❌ Kick User Error:', error);
        responseHelpers.error(res, 'Fehler bei der Kommunikation mit dem Bot');
    }
});

router.post('/users/discord/:userId/ban', requireAuth('admin'), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    const { reason } = req.body;

    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const commandId = await sendCommandToBot('BAN_USER', userId, { reason });
        const result = await waitForCommandResult(commandId);

        if (result.success) {
            logWebAction(req.session.user.id, 'BAN_USER', `Benutzer ${userId} gebannt: ${reason || 'Kein Grund angegeben'}`);
            responseHelpers.success(res, null, result.result);
        } else {
            responseHelpers.error(res, result.error, 400);
        }
    } catch (error) {
        console.error('❌ Ban User Error:', error);
        responseHelpers.error(res, 'Fehler bei der Kommunikation mit dem Bot');
    }
});

router.post('/users/discord/:userId/timeout', requireAuth('admin'), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    const { reason, duration } = req.body;

    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const commandId = await sendCommandToBot('TIMEOUT_USER', userId, { reason, duration });
        const result = await waitForCommandResult(commandId);

        if (result.success) {
            logWebAction(req.session.user.id, 'TIMEOUT_USER', `Benutzer ${userId} timeout: ${duration}s - ${reason || 'Kein Grund angegeben'}`);
            responseHelpers.success(res, null, result.result);
        } else {
            responseHelpers.error(res, result.error, 400);
        }
    } catch (error) {
        console.error('❌ Timeout User Error:', error);
        responseHelpers.error(res, 'Fehler bei der Kommunikation mit dem Bot');
    }
});

router.post('/users/discord/:userId/reset-verification', requireAuth('admin'), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    
    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const newVerificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();

        const result = await dbHelpers.run(`UPDATE users SET verified = 0, verification_code = ? WHERE id = ?`, 
            [newVerificationCode, userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        logWebAction(req.session.user.id, 'RESET_VERIFICATION', 
            `Verifikation für Discord-Benutzer ${userId} zurückgesetzt`);

        responseHelpers.success(res, { newVerificationCode }, 'Verifikation zurückgesetzt');
    } catch (error) {
        console.error('Reset verification error:', error);
        responseHelpers.error(res, 'Fehler beim Zurücksetzen der Verifikation');
    }
});

router.post('/users/discord/:userId/delete-channel', requireAuth('admin'), async (req, res) => {
    const userId = validationHelpers.sanitizeInput(req.params.userId);
    
    if (!validationHelpers.isValidId(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const user = await dbHelpers.get(`SELECT personal_channel_id FROM users WHERE id = ?`, [userId]);

        if (!user || !user.personal_channel_id) {
            return responseHelpers.success(res, null, 'Kein persönlicher Channel vorhanden');
        }

        await dbHelpers.run(`UPDATE users SET personal_channel_id = NULL WHERE id = ?`, [userId]);

        logWebAction(req.session.user.id, 'DELETE_PERSONAL_CHANNEL', 
            `Persönlicher Channel für Discord-Benutzer ${userId} entfernt`);

        responseHelpers.success(res, null, 'Channel-Referenz entfernt (Discord-Channel muss manuell gelöscht werden)');
    } catch (error) {
        console.error('Delete channel error:', error);
        responseHelpers.error(res, 'Fehler beim Löschen der Channel-Referenz');
    }
});

// Web User Management APIs
router.post('/users/web/:userId/reset-password', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    const { newPassword } = req.body;

    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    const passwordError = validationHelpers.validate.password(newPassword);
    if (passwordError) {
        return responseHelpers.error(res, passwordError, 400);
    }

    try {
        const passwordHash = await bcrypt.hash(newPassword, 12);

        const result = await dbHelpers.run(`UPDATE web_users SET password_hash = ? WHERE id = ?`, [passwordHash, userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        logWebAction(req.session.user.id, 'RESET_PASSWORD', `Passwort für Web-Benutzer ${userId} zurückgesetzt`);

        responseHelpers.success(res, null, 'Passwort erfolgreich zurückgesetzt');
    } catch (error) {
        console.error('Password reset error:', error);
        responseHelpers.error(res, 'Fehler beim Zurücksetzen des Passworts');
    }
});

router.post('/users/web/:userId/regenerate-unique', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    
    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const newUniquePassword = crypto.randomBytes(6).toString('hex').toUpperCase();

        const result = await dbHelpers.run(`UPDATE web_users SET unique_password = ? WHERE id = ?`, [newUniquePassword, userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        logWebAction(req.session.user.id, 'REGENERATE_UNIQUE_PASSWORD', `Unique Password für Web-Benutzer ${userId} regeneriert`);

        responseHelpers.success(res, { uniquePassword: newUniquePassword }, 'Unique Password regeneriert');
    } catch (error) {
        console.error('Regenerate unique password error:', error);
        responseHelpers.error(res, 'Fehler beim Regenerieren');
    }
});

router.post('/users/web/:userId/change-role', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    const { newRole } = req.body;

    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    if (!validationHelpers.isValidRole(newRole)) {
        return responseHelpers.error(res, 'Ungültige Rolle', 400);
    }

    try {
        // Check if demoting from admin would leave no admins
        if (newRole === 'mod') {
            const adminCount = await dbHelpers.get(`SELECT COUNT(*) as admin_count FROM web_users WHERE role = 'admin'`);
            
            if (adminCount.admin_count <= 1) {
                return responseHelpers.error(res, 'Mindestens ein Administrator muss vorhanden bleiben', 400);
            }
        }

        const result = await dbHelpers.run(`UPDATE web_users SET role = ? WHERE id = ?`, [newRole, userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        logWebAction(req.session.user.id, 'CHANGE_ROLE', 
            `Rolle für Web-Benutzer ${userId} zu ${newRole} geändert`);

        responseHelpers.success(res, null, `Rolle erfolgreich zu ${newRole} geändert`);
    } catch (error) {
        console.error('Change role error:', error);
        responseHelpers.error(res, 'Fehler beim Ändern der Rolle');
    }
});

router.delete('/users/web/:userId', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);

    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    if (userId === req.session.user.id) {
        return responseHelpers.error(res, 'Du kannst dich nicht selbst löschen', 400);
    }

    try {
        const result = await dbHelpers.run(`DELETE FROM web_users WHERE id = ?`, [userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Benutzer');
        }

        logWebAction(req.session.user.id, 'DELETE_WEB_USER', `Web-Benutzer ${userId} gelöscht`);

        responseHelpers.success(res, null, 'Benutzer erfolgreich gelöscht');
    } catch (error) {
        console.error('Delete user error:', error);
        responseHelpers.error(res, 'Fehler beim Löschen');
    }
});

router.get('/users/web/:userId/logs', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    
    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const logs = await dbHelpers.query(`
            SELECT * FROM web_logs 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 50
        `, [userId]);

        responseHelpers.success(res, { logs: logs || [] });
    } catch (error) {
        console.error('User logs error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Logs');
    }
});

// User Search API
router.get('/users/search', requireAuth(), async (req, res) => {
    const query = validationHelpers.sanitizeInput(req.query.q);

    if (!query || query.length < 2) {
        return responseHelpers.success(res, { discord: [], web: [] });
    }

    try {
        const discordUsers = await dbHelpers.query(`
            SELECT * FROM users 
            WHERE username LIKE ? OR id LIKE ? 
            LIMIT 10
        `, [`%${query}%`, `%${query}%`]);

        const webUsers = await dbHelpers.query(`
            SELECT id, username, role, created_at FROM web_users 
            WHERE username LIKE ? 
            LIMIT 10
        `, [`%${query}%`]);

        responseHelpers.success(res, {
            discord: discordUsers || [],
            web: webUsers || []
        });
    } catch (error) {
        console.error('User search error:', error);
        responseHelpers.error(res, 'Fehler bei der Suche');
    }
});

// Session Management APIs
router.get('/users/web/:userId/sessions', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    
    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const currentSessionId = req.sessionID;

        const sessions = await dbHelpers.query(`
            SELECT 
                session_id,
                user_id,
                device_type,
                created_at,
                last_activity,
                CASE WHEN session_id = ? THEN 1 ELSE 0 END as current
            FROM user_sessions 
            WHERE user_id = ? AND expires_at > datetime('now')
            ORDER BY last_activity DESC
        `, [currentSessionId, userId]);

        logWebAction(req.session.user.id, 'VIEW_USER_SESSIONS', `Sessions für Benutzer ${userId} angezeigt`);

        responseHelpers.success(res, { sessions: sessions || [] });
    } catch (error) {
        console.error('Sessions query error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Sessions');
    }
});

router.post('/users/web/:userId/sessions/:sessionId/terminate', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    const sessionId = validationHelpers.sanitizeInput(req.params.sessionId);
    const currentSessionId = req.sessionID;

    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    if (!validationHelpers.isValidId(sessionId)) {
        return responseHelpers.error(res, 'Ungültige Session-ID', 400);
    }

    if (sessionId === currentSessionId) {
        return responseHelpers.error(res, 'Die aktuelle Session kann nicht beendet werden', 400);
    }

    try {
        const result = await dbHelpers.run(`
            UPDATE user_sessions 
            SET expires_at = datetime('now') 
            WHERE session_id = ? AND user_id = ?
        `, [sessionId, userId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Session');
        }

        logWebAction(req.session.user.id, 'TERMINATE_USER_SESSION', 
            `Session ${sessionId} für Benutzer ${userId} beendet`);

        responseHelpers.success(res, null, 'Session erfolgreich beendet');
    } catch (error) {
        console.error('Terminate session error:', error);
        responseHelpers.error(res, 'Fehler beim Beenden der Session');
    }
});

router.post('/users/web/:userId/sessions/terminate-others', requireAuth('admin'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    const currentSessionId = req.sessionID;

    if (!userId || isNaN(userId)) {
        return responseHelpers.error(res, 'Ungültige User-ID', 400);
    }

    try {
        const result = await dbHelpers.run(`
            UPDATE user_sessions 
            SET expires_at = datetime('now') 
            WHERE user_id = ? AND session_id != ? AND expires_at > datetime('now')
        `, [userId, currentSessionId]);

        logWebAction(req.session.user.id, 'TERMINATE_OTHER_USER_SESSIONS', 
            `${result.changes} Sessions für Benutzer ${userId} beendet`);

        responseHelpers.success(res, { 
            terminated_count: result.changes 
        }, `${result.changes} Sessions beendet`);
    } catch (error) {
        console.error('Terminate other sessions error:', error);
        responseHelpers.error(res, 'Fehler beim Beenden der Sessions');
    }
});

// Message Search API
router.get('/messages/search', requireAuth(), async (req, res) => {
    const query = validationHelpers.sanitizeInput(req.query.q);

    if (!query || query.length < 2) {
        return responseHelpers.success(res, []);
    }

    try {
        const messages = await dbHelpers.query(`
            SELECT * FROM message_logs 
            WHERE content LIKE ? OR username LIKE ? 
            ORDER BY timestamp DESC 
            LIMIT 20
        `, [`%${query}%`, `%${query}%`]);

        responseHelpers.success(res, messages || []);
    } catch (error) {
        console.error('Message search error:', error);
        responseHelpers.success(res, []); // Return empty array on error for search
    }
});

// Bot Status and Management APIs
router.get('/bot/status', requireAuth(), async (req, res) => {
    try {
        const lastCommand = await dbHelpers.get(`
            SELECT * FROM bot_commands 
            WHERE status IN ('completed', 'failed') 
            ORDER BY executed_at DESC 
            LIMIT 1
        `);

        const now = new Date();
        const lastActivity = lastCommand ? new Date(lastCommand.executed_at) : null;
        const timeSinceLastActivity = lastActivity ? (now - lastActivity) / 1000 : null;

        const botOnline = timeSinceLastActivity !== null && timeSinceLastActivity < 60;

        const lastMessage = await dbHelpers.get(`
            SELECT timestamp FROM message_logs 
            ORDER BY timestamp DESC 
            LIMIT 1
        `);
        
        const lastMessageTime = lastMessage ? new Date(lastMessage.timestamp) : null;
        const messageTimeDiff = lastMessageTime ? (now - lastMessageTime) / 1000 : null;

        responseHelpers.success(res, {
            online: botOnline,
            last_activity: lastActivity,
            seconds_since_activity: timeSinceLastActivity,
            last_message_time: lastMessageTime,
            seconds_since_message: messageTimeDiff,
            last_command: lastCommand ? {
                type: lastCommand.command_type,
                status: lastCommand.status,
                result: lastCommand.result
            } : null
        });
    } catch (error) {
        console.error('Bot status error:', error);
        responseHelpers.error(res, 'Fehler beim Laden des Bot-Status');
    }
});

router.get('/bot/commands', requireAuth('admin'), async (req, res) => {
    try {
        const commands = await dbHelpers.query(`
            SELECT * FROM bot_commands 
            ORDER BY created_at DESC 
            LIMIT 50
        `);

        responseHelpers.success(res, { commands });
    } catch (error) {
        console.error('Bot commands error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Commands');
    }
});

router.post('/bot/commands/:commandId/cancel', requireAuth('admin'), async (req, res) => {
    const commandId = parseInt(req.params.commandId);
    
    if (!commandId || isNaN(commandId)) {
        return responseHelpers.error(res, 'Ungültige Command-ID', 400);
    }

    try {
        const result = await dbHelpers.run(`
            UPDATE bot_commands 
            SET status = 'cancelled', executed_at = ?, result = ? 
            WHERE id = ? AND status = 'pending'
        `, [new Date().toISOString(), 'Manuell abgebrochen über Web-Interface', commandId]);

        if (result.changes === 0) {
            return responseHelpers.notFound(res, 'Command nicht gefunden oder bereits ausgeführt');
        }

        logWebAction(req.session.user.id, 'CANCEL_COMMAND', `Command ${commandId} manuell abgebrochen`);
        
        responseHelpers.success(res, null, 'Command abgebrochen');
    } catch (error) {
        console.error('Cancel command error:', error);
        responseHelpers.error(res, 'Fehler beim Abbrechen des Commands');
    }
});

router.post('/bot/test', requireAuth('admin'), async (req, res) => {
    try {
        const commandId = await sendCommandToBot('TEST', 'test-target', { message: 'Test vom Web-Interface' });

        logWebAction(req.session.user.id, 'TEST_COMMAND', `Test-Command ${commandId} gesendet`);

        responseHelpers.success(res, { commandId }, 'Test-Command gesendet');
    } catch (error) {
        console.error('❌ Test Command Error:', error);
        responseHelpers.error(res, 'Fehler beim Senden des Test-Commands');
    }
});

// System Management APIs
router.get('/system/status', requireAuth(), async (req, res) => {
    try {
        const stats = await dbHelpers.get(`
            SELECT 
                (SELECT COUNT(*) FROM message_logs) as total_messages,
                (SELECT COUNT(*) FROM tickets) as total_tickets,
                (SELECT COUNT(*) FROM users) as total_discord_users,
                (SELECT COUNT(*) FROM web_users) as total_web_users,
                (SELECT COUNT(*) FROM temp_channels) as active_temp_channels,
                (SELECT COUNT(*) FROM web_logs) as total_web_logs
        `);

        const systemInfo = {
            stats: stats || {},
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: '1.1.0',
            environment: process.env.NODE_ENV || 'development'
        };

        responseHelpers.success(res, systemInfo);
    } catch (error) {
        console.error('System status error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der System-Statistiken');
    }
});

router.get('/system/health', requireAuth('admin'), async (req, res) => {
    const healthChecks = [];

    try {
        // Database connection check
        const result = await dbHelpers.get(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'`);
        healthChecks.push({ name: 'database', status: 'ok', tables: result.count });

        // Check required tables
        const requiredTables = ['users', 'message_logs', 'tickets', 'web_users', 'web_logs', 'temp_channels', 'bot_commands'];
        
        for (const tableName of requiredTables) {
            try {
                const tableResult = await dbHelpers.get(`SELECT COUNT(*) as count FROM ${tableName}`);
                healthChecks.push({ name: tableName, status: 'ok', rows: tableResult.count });
            } catch (err) {
                healthChecks.push({ name: tableName, status: 'error', message: err.message });
            }
        }

        const overallStatus = healthChecks.every(check => check.status === 'ok') ? 'healthy' : 'unhealthy';

        res.json({
            status: overallStatus,
            checks: healthChecks,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Data Export APIs
router.get('/system/export/:type', requireAuth('admin'), async (req, res) => {
    const exportType = validationHelpers.sanitizeInput(req.params.type);

    if (!['messages', 'users', 'tickets', 'logs', 'bot_commands'].includes(exportType)) {
        return responseHelpers.error(res, 'Unbekannter Export-Typ', 400);
    }

    logWebAction(req.session.user.id, 'EXPORT_DATA', `Daten-Export: ${exportType}`);

    try {
        let data;
        let filename;

        switch (exportType) {
            case 'messages':
                data = await dbHelpers.query(`SELECT * FROM message_logs ORDER BY timestamp DESC`);
                filename = `messages_export_${Date.now()}.json`;
                break;

            case 'users':
                data = await dbHelpers.query(`SELECT * FROM users ORDER BY joined_at DESC`);
                filename = `users_export_${Date.now()}.json`;
                break;

            case 'tickets':
                data = await dbHelpers.query(`SELECT * FROM tickets ORDER BY created_at DESC`);
                filename = `tickets_export_${Date.now()}.json`;
                break;

            case 'logs':
                data = await dbHelpers.query(`
                    SELECT wl.*, wu.username 
                    FROM web_logs wl 
                    LEFT JOIN web_users wu ON wl.user_id = wu.id 
                    ORDER BY wl.timestamp DESC
                `);
                filename = `web_logs_export_${Date.now()}.json`;
                break;

            case 'bot_commands':
                data = await dbHelpers.query(`SELECT * FROM bot_commands ORDER BY created_at DESC`);
                filename = `bot_commands_export_${Date.now()}.json`;
                break;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(data);

    } catch (error) {
        console.error('Export error:', error);
        responseHelpers.error(res, 'Fehler beim Export');
    }
});

// Database Management APIs
router.get('/system/database/stats', requireAuth('admin'), async (req, res) => {
    try {
        const stats = {};
        const tables = ['users', 'message_logs', 'tickets', 'web_users', 'web_logs', 'temp_channels', 'bot_commands'];
        
        for (const table of tables) {
            try {
                const result = await dbHelpers.get(`SELECT COUNT(*) as count FROM ${table}`);
                stats[table] = { count: result.count };
            } catch (err) {
                stats[table] = { error: err.message };
            }
        }

        responseHelpers.success(res, {
            stats: stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Database stats error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der Datenbankstatistiken');
    }
});

router.post('/system/database/cleanup', requireAuth('admin'), async (req, res) => {
    const { days = 30 } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffISO = cutoffDate.toISOString();

    try {
        const results = {};

        // Cleanup web logs
        const webLogsResult = await dbHelpers.run(`DELETE FROM web_logs WHERE timestamp < ?`, [cutoffISO]);
        results.web_logs = { deleted: webLogsResult.changes };

        // Cleanup bot commands
        const botCommandsResult = await dbHelpers.run(`
            DELETE FROM bot_commands 
            WHERE created_at < ? AND status IN ('completed', 'failed', 'cancelled')
        `, [cutoffISO]);
        results.bot_commands = { deleted: botCommandsResult.changes };

        // Cleanup expired sessions
        const sessionsResult = await dbHelpers.run(`DELETE FROM user_sessions WHERE expires_at < datetime('now')`);
        results.user_sessions = { deleted: sessionsResult.changes };

        logWebAction(req.session.user.id, 'DATABASE_CLEANUP', `Datenbankbereinigung durchgeführt: ${days} Tage`);

        responseHelpers.success(res, {
            results: results,
            timestamp: new Date().toISOString()
        }, `Datenbankbereinigung abgeschlossen (${days} Tage)`);

    } catch (error) {
        console.error('Database cleanup error:', error);
        responseHelpers.error(res, 'Fehler bei der Datenbankbereinigung');
    }
});

// 404 handler for unknown API endpoints
router.use('*', (req, res) => {
    responseHelpers.notFound(res, 'API-Endpunkt');
});

module.exports = router;