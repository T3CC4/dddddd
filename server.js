const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const expressLayouts = require('express-ejs-layouts');

// Import our centralized utilities
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

const app = express();
const db = new sqlite3.Database('./bot_database.sqlite');

// Initialize database reference in utils
setDatabase(db);

// Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'your-secret-key-change-this-14th-squad',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Session tracking middleware
app.use((req, res, next) => {
    if (req.session && req.session.user) {
        const userId = req.session.user.id;
        const sessionId = req.sessionID;
        const userAgent = req.headers['user-agent'] || 'Unknown';
        
        let deviceType = 'Desktop';
        if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
            deviceType = /iPad/.test(userAgent) ? 'Tablet' : 'Mobile';
        }
        
        const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000));

        // Use centralized dbHelpers instead of direct db access
        dbHelpers.run(`
            INSERT OR REPLACE INTO user_sessions 
            (session_id, user_id, device_type, last_activity, expires_at) 
            VALUES (?, ?, ?, datetime('now'), ?)
        `, [sessionId, userId, deviceType, expiresAt.toISOString()])
        .catch(err => console.error('Session tracking error:', err));
        
        // Cleanup old sessions occasionally
        if (Math.random() < 0.01) {
            dbHelpers.run(`DELETE FROM user_sessions WHERE expires_at < datetime('now')`)
            .catch(err => console.error('Session cleanup error:', err));
        }
    }
    
    next();
});

// Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login', { 
        error: null,
        layout: false
    });
});

app.post('/login', async (req, res) => {
    const { username, password, uniquePassword } = req.body;
    
    // Validate input using centralized validation
    const usernameError = validationHelpers.validate.required(username, 'Benutzername');
    const passwordError = validationHelpers.validate.required(password, 'Passwort');
    const uniquePasswordError = validationHelpers.validate.required(uniquePassword, 'Unique Password');
    
    if (usernameError || passwordError || uniquePasswordError) {
        return res.render('login', { 
            error: usernameError || passwordError || uniquePasswordError,
            layout: false
        });
    }
    
    try {
        const user = await dbHelpers.get(`SELECT * FROM web_users WHERE username = ?`, [username]);
        
        if (!user) {
            return res.render('login', { 
                error: 'Ungültige Anmeldedaten',
                layout: false
            });
        }
        
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        const uniquePasswordValid = user.unique_password === uniquePassword;
        
        if (passwordValid && uniquePasswordValid) {
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role
            };
            
            // Update last login using centralized helpers
            await dbHelpers.run(`UPDATE web_users SET last_login = ? WHERE id = ?`, 
                [new Date().toISOString(), user.id]);
            
            logWebAction(user.id, 'LOGIN', 'Benutzer hat sich angemeldet');
            
            res.redirect('/dashboard');
        } else {
            res.render('login', { 
                error: 'Ungültige Anmeldedaten',
                layout: false
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { 
            error: 'Fehler beim Anmelden',
            layout: false
        });
    }
});

app.get('/logout', (req, res) => {
    if (req.session.user) {
        logWebAction(req.session.user.id, 'LOGOUT', 'Benutzer hat sich abgemeldet');
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
        }
        res.redirect('/login');
    });
});

app.get('/dashboard', requireAuth(), async (req, res) => {
    try {
        // Get dashboard stats using centralized query helpers
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM message_logs) as total_messages,
                (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
                (SELECT COUNT(*) FROM users WHERE verified = 1) as verified_users,
                (SELECT COUNT(*) FROM temp_channels) as active_temp_channels,
                (SELECT COUNT(*) FROM users) as total_discord_users,
                (SELECT COUNT(*) FROM web_users) as total_web_users
        `;
        
        const stats = await dbHelpers.get(statsQuery);
        const data = stats || { 
            total_messages: 0, 
            open_tickets: 0, 
            verified_users: 0, 
            active_temp_channels: 0,
            total_discord_users: 0,
            total_web_users: 0
        };
        
        // Get activities using centralized query helper
        const activitiesQueryData = queryHelpers.getActivitiesQuery(10);
        const activities = await dbHelpers.query(activitiesQueryData.query, activitiesQueryData.params);
        
        // Format activities using centralized formatter
        const formattedActivities = queryHelpers.formatActivities(activities);
        
        logWebAction(req.session.user.id, 'VIEW_DASHBOARD', 'Dashboard aufgerufen');
        
        res.render('dashboard', { 
            user: req.session.user, 
            stats: data,
            activities: formattedActivities,
            title: 'Dashboard - 14th Squad Management'
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).render('error', { 
            error: 'Fehler beim Laden des Dashboards',
            layout: false
        });
    }
});

app.get('/messages', requireAuth(), async (req, res) => {
    const search = validationHelpers.sanitizeInput(req.query.search) || '';
    const channel = validationHelpers.sanitizeInput(req.query.channel) || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    
    try {
        let query = `
            SELECT ml.*, u.username as real_username, u.avatar_hash, u.discriminator
            FROM message_logs ml
            LEFT JOIN users u ON ml.user_id = u.id
            WHERE 1=1
        `;
        let params = [];
        
        if (search) {
            query += ` AND (ml.content LIKE ? OR ml.username LIKE ? OR ml.channel_name LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        if (channel) {
            query += ` AND ml.channel_name = ?`;
            params.push(channel);
        }
        
        query += ` ORDER BY ml.timestamp DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        
        const messages = await dbHelpers.query(query, params);
        
        // Enhance messages with user data
        const enhancedMessages = messages.map(msg => ({
            ...msg,
            username: msg.real_username || msg.username || 'Unbekannt',
            avatar_hash: msg.avatar_hash || null,
            discriminator: msg.discriminator || null
        }));
        
        // Get total count for pagination
        let countQuery = `SELECT COUNT(*) as count FROM message_logs WHERE 1=1`;
        let countParams = [];
        
        if (search) {
            countQuery += ` AND (content LIKE ? OR username LIKE ? OR channel_name LIKE ?)`;
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        if (channel) {
            countQuery += ` AND channel_name = ?`;
            countParams.push(channel);
        }
        
        const countResult = await dbHelpers.get(countQuery, countParams);
        const totalPages = Math.ceil((countResult?.count || 0) / limit);
        
        logWebAction(req.session.user.id, 'VIEW_MESSAGES', 
            `Seite ${page}, Suche: ${search}, Channel: ${channel}`);
        
        res.render('messages', { 
            user: req.session.user,
            messages: enhancedMessages || [],
            search,
            channel,
            currentPage: page,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
            title: 'Nachrichten - 14th Squad Management'
        });
    } catch (error) {
        console.error('Messages error:', error);
        res.status(500).render('error', { 
            error: 'Fehler beim Laden der Nachrichten',
            layout: false
        });
    }
});

app.get('/tickets', requireAuth(), async (req, res) => {
    try {
        const tickets = await dbHelpers.query(`
            SELECT t.*, u.username 
            FROM tickets t 
            LEFT JOIN users u ON t.user_id = u.id 
            ORDER BY t.created_at DESC
        `);
        
        logWebAction(req.session.user.id, 'VIEW_TICKETS', 'Ticket-Übersicht aufgerufen');
        
        res.render('tickets', { 
            user: req.session.user,
            tickets: tickets || [],
            title: 'Tickets - 14th Squad Management'
        });
    } catch (error) {
        console.error('Tickets error:', error);
        res.status(500).render('error', { 
            error: 'Fehler beim Laden der Tickets',
            layout: false
        });
    }
});

app.get('/tickets/:ticketId', requireAuth(), async (req, res) => {
    const ticketId = validationHelpers.sanitizeInput(req.params.ticketId);
    
    if (!validationHelpers.isValidId(ticketId)) {
        return res.status(400).render('error', { 
            error: 'Ungültige Ticket-ID',
            layout: false
        });
    }
    
    try {
        const ticket = await dbHelpers.get(`
            SELECT t.*, u.username, u.avatar_hash, u.discriminator 
            FROM tickets t 
            LEFT JOIN users u ON t.user_id = u.id 
            WHERE t.ticket_id = ?
        `, [ticketId]);
        
        if (!ticket) {
            return res.status(404).render('error', { 
                error: 'Ticket nicht gefunden',
                layout: false
            });
        }
        
        let messages = await dbHelpers.query(`
            SELECT ml.*, u.username as real_username, u.avatar_hash, u.discriminator
            FROM message_logs ml
            LEFT JOIN users u ON ml.user_id = u.id
            WHERE ml.channel_id = ? 
            ORDER BY ml.timestamp ASC
        `, [ticket.channel_id]);
        
        // Fallback to transcript if no messages found
        if (messages.length === 0 && ticket.transcript) {
            try {
                const transcriptMessages = JSON.parse(ticket.transcript);
                messages = transcriptMessages.map(msg => ({
                    ...msg,
                    username: msg.username || 'Unbekannt',
                    avatar_hash: null,
                    discriminator: null,
                    real_username: msg.username
                }));
            } catch (parseError) {
                console.error('Transcript parse error:', parseError);
                messages = [];
            }
        }
        
        const enhancedMessages = messages.map(msg => ({
            ...msg,
            username: msg.real_username || msg.username || 'Unbekannt',
            avatar_hash: msg.avatar_hash || null,
            discriminator: msg.discriminator || null
        }));
        
        logWebAction(req.session.user.id, 'VIEW_TICKET', `Ticket ${ticketId} angezeigt`);
        
        res.render('ticket_detail', { 
            user: req.session.user,
            ticket: {
                ...ticket,
                username: ticket.username || 'Unbekannter Benutzer'
            },
            messages: enhancedMessages || [],
            title: `Ticket ${ticketId} - 14th Squad Management`
        });
    } catch (error) {
        console.error('Ticket detail error:', error);
        res.status(500).render('error', { 
            error: 'Fehler beim Laden des Tickets',
            layout: false
        });
    }
});

app.get('/users', requireAuth('admin'), async (req, res) => {
    try {
        // Try enhanced query first, fall back to basic if needed
        let discordUsers;
        try {
            discordUsers = await dbHelpers.query(`
                SELECT 
                    u.*,
                    (SELECT COUNT(*) FROM message_logs WHERE user_id = u.id AND user_id != 'SYSTEM') as message_count,
                    (SELECT COUNT(*) FROM tickets WHERE user_id = u.id) as ticket_count,
                    (SELECT COUNT(*) FROM temp_channels WHERE owner_id = u.id) as voice_channel_count
                FROM users u 
                ORDER BY u.joined_at DESC
            `);
        } catch (enhancedError) {
            console.error('Enhanced query failed, using fallback:', enhancedError);
            const basicUsers = await dbHelpers.query('SELECT * FROM users ORDER BY joined_at DESC');
            discordUsers = basicUsers.map(user => ({
                ...user,
                message_count: 0,
                ticket_count: 0,
                voice_channel_count: 0
            }));
        }
        
        const webUsers = await dbHelpers.query(`SELECT * FROM web_users ORDER BY created_at DESC`);
        
        logWebAction(req.session.user.id, 'VIEW_USERS', 'Benutzerverwaltung aufgerufen');
        
        res.render('users', { 
            user: req.session.user,
            discordUsers: discordUsers || [],
            webUsers: webUsers || [],
            title: 'Benutzerverwaltung - 14th Squad Management'
        });
    } catch (error) {
        console.error('Users error:', error);
        res.status(500).render('error', { 
            error: 'Fehler beim Laden der Benutzerverwaltung',
            layout: false
        });
    }
});

// Admin routes
app.post('/admin/sync-avatars', requireAuth('admin'), async (req, res) => {
    try {
        const { syncAllAvatarsCommand } = require('./bot.js');
        
        if (syncAllAvatarsCommand) {
            await syncAllAvatarsCommand();
            logWebAction(req.session.user.id, 'SYNC_AVATARS', 'Avatar-Synchronisation manuell gestartet');
            responseHelpers.success(res, null, 'Avatar-Synchronisation gestartet');
        } else {
            responseHelpers.error(res, 'Bot-Verbindung nicht verfügbar', 503);
        }
    } catch (error) {
        console.error('Avatar sync error:', error);
        responseHelpers.error(res, 'Fehler bei der Avatar-Synchronisation');
    }
});

app.get('/admin/system-status', requireAuth('admin'), async (req, res) => {
    try {
        const stats = await dbHelpers.get(`
            SELECT 
                (SELECT COUNT(*) FROM message_logs) as total_messages,
                (SELECT COUNT(*) FROM tickets) as total_tickets,
                (SELECT COUNT(*) FROM users) as total_discord_users,
                (SELECT COUNT(*) FROM users WHERE avatar_hash IS NOT NULL) as users_with_avatars,
                (SELECT COUNT(*) FROM web_users) as total_web_users,
                (SELECT COUNT(*) FROM temp_channels) as active_temp_channels,
                (SELECT COUNT(*) FROM web_logs) as total_web_logs,
                (SELECT COUNT(*) FROM bot_commands WHERE status = 'pending') as pending_commands,
                (SELECT MAX(timestamp) FROM message_logs) as last_message_time
        `);
        
        const systemInfo = {
            stats: stats || {},
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: '1.1.0',
            environment: process.env.NODE_ENV || 'development',
            avatar_support: true,
            database_version: '1.1.0'
        };
        
        responseHelpers.success(res, systemInfo);
    } catch (error) {
        console.error('System status error:', error);
        responseHelpers.error(res, 'Fehler beim Laden der System-Statistiken');
    }
});

// Logs anzeigen (nur Admin)
app.get('/logs', requireAuth('admin'), async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 100;
    const offset = (page - 1) * limit;
    
    try {
        const logs = await dbHelpers.query(`
            SELECT wl.*, wu.username 
            FROM web_logs wl 
            LEFT JOIN web_users wu ON wl.user_id = wu.id 
            ORDER BY wl.timestamp DESC 
            LIMIT ? OFFSET ?
        `, [limit, offset]);
        
        const countResult = await dbHelpers.get(`SELECT COUNT(*) as count FROM web_logs`);
        const totalPages = Math.ceil((countResult?.count || 0) / limit);
        
        res.render('logs', { 
            user: req.session.user,
            logs: logs || [],
            currentPage: page,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
            title: 'Web Logs - 14th Squad Management'
        });
    } catch (error) {
        console.error('Logs error:', error);
        res.status(500).render('error', { 
            error: 'Fehler beim Laden der Logs',
            layout: false
        });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const result = await dbHelpers.get(`SELECT COUNT(*) as user_count FROM users`);
        
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: 'connected',
            user_count: result?.user_count || 0,
            version: '1.1.0',
            features: {
                avatars: true,
                tickets: true,
                messages: true,
                web_interface: true,
                centralized_utils: true
            }
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: 'Database connection failed',
            timestamp: new Date().toISOString()
        });
    }
});

// Create web user endpoint
app.post('/users/web/create', requireAuth('admin'), async (req, res) => {
    const { username, password, role } = req.body;
    
    // Validate input using centralized validation
    const usernameError = validationHelpers.validate.username(username);
    const passwordError = validationHelpers.validate.password(password);
    const roleError = validationHelpers.isValidRole(role) ? null : 'Ungültige Rolle';
    
    if (usernameError) {
        return responseHelpers.error(res, usernameError, 400);
    }
    if (passwordError) {
        return responseHelpers.error(res, passwordError, 400);
    }
    if (roleError) {
        return responseHelpers.error(res, roleError, 400);
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const uniquePassword = crypto.randomBytes(6).toString('hex').toUpperCase();
        
        const result = await dbHelpers.run(`
            INSERT INTO web_users (username, password_hash, role, unique_password, created_at) 
            VALUES (?, ?, ?, ?, ?)
        `, [username, passwordHash, role, uniquePassword, new Date().toISOString()]);
        
        logWebAction(req.session.user.id, 'CREATE_WEB_USER', 
            `Neuer Web-Benutzer erstellt: ${username} (${role})`);
        
        responseHelpers.success(res, { uniquePassword }, 'Benutzer erstellt');
    } catch (error) {
        console.error('Create user error:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            responseHelpers.error(res, 'Benutzername bereits vergeben', 400);
        } else {
            responseHelpers.error(res, 'Fehler beim Erstellen des Benutzers');
        }
    }
});

// Load API routes
const apiRoutes = require('./api');
app.use('/api', apiRoutes);

// API 404 handler
app.use('/api/*', (req, res) => {
    responseHelpers.notFound(res, 'API-Endpunkt');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    
    if (req.session && req.session.user) {
        logWebAction(req.session.user.id, 'ERROR', `Server Error: ${err.message}`);
    }
    
    if (req.path.startsWith('/api/')) {
        responseHelpers.error(res, 'Interner Serverfehler');
    } else {
        res.status(500).render('error', { 
            error: 'Etwas ist schiefgelaufen!',
            layout: false
        });
    }
});

// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        responseHelpers.notFound(res, 'API-Endpunkt');
    } else {
        res.status(404).render('error', { 
            error: 'Seite nicht gefunden',
            layout: false
        });
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutdown-Signal empfangen...');
    
    db.close((err) => {
        if (err) {
            console.error('❌ Fehler beim Schließen der Datenbank:', err);
        } else {
            console.log('✅ Datenbank-Verbindung geschlossen');
        }
        
        console.log('👋 Web-Interface beendet');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Terminate-Signal empfangen...');
    
    db.close((err) => {
        if (err) {
            console.error('❌ Fehler beim Schließen der Datenbank:', err);
        }
        process.exit(0);
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    
    db.close(() => {
        process.exit(1);
    });
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log('🚀 ===================================');
    console.log('🎮 14th Squad Management System v1.1');
    console.log('🚀 ===================================');
    console.log(`🌐 Web-Interface läuft auf Port ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔐 Login: http://localhost:${PORT}/login`);
    console.log('✨ Centralized Utils loaded');
    console.log('🚀 ===================================');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} ist bereits in Verwendung!`);
        console.log(`💡 Versuche einen anderen Port oder beende den anderen Prozess.`);
    } else {
        console.error('❌ Server-Fehler:', err);
    }
    process.exit(1);
});

module.exports = { 
    app, 
    db,
    requireAuth, 
    logWebAction, 
    sendCommandToBot, 
    waitForCommandResult 
};