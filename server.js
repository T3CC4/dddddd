const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const expressLayouts = require('express-ejs-layouts');

const app = express();
const db = new sqlite3.Database('./bot_database.sqlite');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Layout Setup
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session Setup
app.use(session({
    secret: 'your-secret-key-change-this-14th-squad',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 Stunden
}));

// Middleware für Authentication
const requireAuth = (requiredRole = 'mod') => {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        
        if (requiredRole === 'admin' && req.session.user.role !== 'admin') {
            return res.status(403).render('error', { 
                error: 'Zugriff verweigert. Admin-Berechtigung erforderlich.',
                layout: false
            });
        }
        
        next();
    };
};

// Hilfsfunktion für Web Logs (OHNE IP-Adresse aus Sicherheitsgründen)
function logWebAction(userId, action, details) {
    db.run(`INSERT INTO web_logs (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)`,
        [userId, action, details, new Date().toISOString()]
    );
}

// Bot-Server Kommunikationsfunktionen
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

// ===================
// HAUPTROUTEN
// ===================

// Root Redirect
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

// Login Seite
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login', { 
        error: null,
        layout: false
    });
});

// Login POST
app.post('/login', (req, res) => {
    const { username, password, uniquePassword } = req.body;
    
    if (!username || !password || !uniquePassword) {
        return res.render('login', { 
            error: 'Alle Felder sind erforderlich',
            layout: false
        });
    }
    
    db.get(`SELECT * FROM web_users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) {
            return res.render('login', { 
                error: 'Ungültige Anmeldedaten',
                layout: false
            });
        }
        
        try {
            const passwordValid = await bcrypt.compare(password, user.password_hash);
            const uniquePasswordValid = user.unique_password === uniquePassword;
            
            if (passwordValid && uniquePasswordValid) {
                req.session.user = {
                    id: user.id,
                    username: user.username,
                    role: user.role
                };
                
                // Update last login
                db.run(`UPDATE web_users SET last_login = ? WHERE id = ?`, 
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
});

// Logout
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

// Dashboard
app.get('/dashboard', requireAuth(), (req, res) => {
    // Statistiken abrufen
    db.all(`
        SELECT 
            (SELECT COUNT(*) FROM message_logs) as total_messages,
            (SELECT COUNT(*) FROM tickets WHERE status = 'open') as open_tickets,
            (SELECT COUNT(*) FROM users WHERE verified = 1) as verified_users,
            (SELECT COUNT(*) FROM temp_channels) as active_temp_channels,
            (SELECT COUNT(*) FROM users) as total_discord_users,
            (SELECT COUNT(*) FROM web_users) as total_web_users
    `, (err, stats) => {
        if (err) {
            console.error('Dashboard stats error:', err);
        }
        
        const data = stats[0] || { 
            total_messages: 0, 
            open_tickets: 0, 
            verified_users: 0, 
            active_temp_channels: 0,
            total_discord_users: 0,
            total_web_users: 0
        };
        
        // Aktivitäten Query
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
            
            UNION ALL
            
            SELECT 
                'system_message' as type,
                username as actor,
                channel_name as target,
                content as details,
                timestamp,
                'fas fa-cog' as icon,
                'warning' as color
            FROM message_logs 
            WHERE user_id = 'SYSTEM'
            
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
            
            UNION ALL
            
            SELECT 
                'ticket_closed' as type,
                'System' as actor,
                ticket_id as target,
                'Ticket geschlossen' as details,
                closed_at as timestamp,
                'fas fa-lock' as icon,
                'danger' as color
            FROM tickets 
            WHERE status = 'closed' 
                AND closed_at IS NOT NULL
            
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
            
            UNION ALL
            
            SELECT 
                'user_joined' as type,
                username as actor,
                'Server' as target,
                'Ist dem Server beigetreten' as details,
                joined_at as timestamp,
                'fas fa-user-plus' as icon,
                'primary' as color
            FROM users
            
            UNION ALL
            
            SELECT 
                'web_activity' as type,
                COALESCE(wu.username, 'Unbekannt') as actor,
                wl.action as target,
                wl.details as details,
                wl.timestamp,
                'fas fa-globe' as icon,
                'secondary' as color
            FROM web_logs wl
            LEFT JOIN web_users wu ON wl.user_id = wu.id
            WHERE wl.action NOT IN ('LOGIN', 'LOGOUT')
            
            ORDER BY timestamp DESC
            LIMIT 10
        `;
        
        db.all(activitiesQuery, (err, activities) => {
            if (err) {
                console.error('Activities query error:', err);
                activities = [];
            }
            
            // Aktivitäten verarbeiten und formatieren
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
                    case 'system_message':
                        activityText = `System: ${activity.details || 'System-Nachricht'}`;
                        break;
                    case 'ticket_created':
                        activityText = `${activity.actor || 'Unbekannter Benutzer'} erstellte Ticket ${activity.target}`;
                        break;
                    case 'ticket_closed':
                        activityText = `Ticket ${activity.target} wurde geschlossen`;
                        break;
                    case 'user_verified':
                        activityText = `${activity.actor} wurde verifiziert`;
                        break;
                    case 'user_joined':
                        activityText = `${activity.actor} ist dem Server beigetreten`;
                        break;
                    case 'web_activity':
                        activityText = `${activity.actor}: ${activity.target} - ${activity.details || 'Web-Aktivität'}`;
                        break;
                    default:
                        activityText = `${activity.actor || 'Unbekannt'}: ${activity.details || 'Aktivität'}`;
                }
                
                return {
                    type: activity.type,
                    icon: activity.icon,
                    color: activity.color,
                    text: activityText,
                    actor: activity.actor,
                    target: activity.target,
                    time: timeAgo,
                    timestamp: activity.timestamp
                };
            });
            
            res.render('dashboard', { 
                user: req.session.user, 
                stats: data,
                activities: formattedActivities,
                title: 'Dashboard - 14th Squad Management'
            });
        });
    });
});

// Message Logs
app.get('/messages', requireAuth(), (req, res) => {
    const search = req.query.search || '';
    const channel = req.query.channel || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    
    let query = `SELECT * FROM message_logs WHERE 1=1`;
    let params = [];
    
    if (search) {
        query += ` AND (content LIKE ? OR username LIKE ? OR channel_name LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (channel) {
        query += ` AND channel_name = ?`;
        params.push(channel);
    }
    
    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    db.all(query, params, (err, messages) => {
        if (err) {
            console.error('Messages query error:', err);
            messages = [];
        }
        
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
        
        db.get(countQuery, countParams, (err, count) => {
            if (err) {
                console.error('Messages count error:', err);
                count = { count: 0 };
            }
            
            const totalPages = Math.ceil(count.count / limit);
            
            logWebAction(req.session.user.id, 'VIEW_MESSAGES', 
                `Seite ${page}, Suche: ${search}, Channel: ${channel}`);
            
            res.render('messages', { 
                user: req.session.user,
                messages: messages || [],
                search,
                channel,
                currentPage: page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                title: 'Nachrichten - 14th Squad Management'
            });
        });
    });
});

// Ticket Management
app.get('/tickets', requireAuth(), (req, res) => {
    db.all(`
        SELECT t.*, u.username 
        FROM tickets t 
        LEFT JOIN users u ON t.user_id = u.id 
        ORDER BY t.created_at DESC
    `, (err, tickets) => {
        if (err) {
            console.error('Tickets query error:', err);
            tickets = [];
        }
        
        logWebAction(req.session.user.id, 'VIEW_TICKETS', 'Ticket-Übersicht aufgerufen');
        
        res.render('tickets', { 
            user: req.session.user,
            tickets: tickets || [],
            title: 'Tickets - 14th Squad Management'
        });
    });
});

// Einzelnes Ticket anzeigen
app.get('/tickets/:ticketId', requireAuth(), (req, res) => {
    const ticketId = req.params.ticketId;
    
    db.get(`SELECT * FROM tickets WHERE ticket_id = ?`, [ticketId], (err, ticket) => {
        if (err || !ticket) {
            return res.status(404).render('error', { 
                error: 'Ticket nicht gefunden',
                layout: false
            });
        }
        
        // Lade Nachrichten aus diesem Ticket-Channel
        db.all(`
            SELECT * FROM message_logs 
            WHERE channel_id = ? 
            ORDER BY timestamp ASC
        `, [ticket.channel_id], (err, messages) => {
            if (err) {
                console.error('Ticket messages error:', err);
                messages = [];
            }
            
            logWebAction(req.session.user.id, 'VIEW_TICKET', `Ticket ${ticketId} angezeigt`);
            
            res.render('ticket_detail', { 
                user: req.session.user,
                ticket,
                messages: messages || [],
                title: `Ticket ${ticketId} - 14th Squad Management`
            });
        });
    });
});

// User Management (nur Admin)
app.get('/users', requireAuth('admin'), (req, res) => {
    // Lade Discord-Benutzer
    db.all(`
        SELECT 
            u.*,
            (SELECT COUNT(*) FROM message_logs WHERE user_id = u.id AND user_id != 'SYSTEM') as message_count,
            (SELECT COUNT(*) FROM tickets WHERE user_id = u.id) as ticket_count,
            (SELECT COUNT(*) FROM temp_channels WHERE owner_id = u.id) as voice_channel_count
        FROM users u 
        ORDER BY u.joined_at DESC
    `, (err, discordUsers) => {
        if (err) {
            console.error('Discord users query error:', err);
            discordUsers = [];
        }
        
        // Lade Web-Benutzer
        db.all(`SELECT * FROM web_users ORDER BY created_at DESC`, (err, webUsers) => {
            if (err) {
                console.error('Web users query error:', err);
                webUsers = [];
            }
            
            logWebAction(req.session.user.id, 'VIEW_USERS', 'Benutzerverwaltung aufgerufen');
            
            res.render('users', { 
                user: req.session.user,
                discordUsers: discordUsers || [],
                webUsers: webUsers || [],
                title: 'Benutzerverwaltung - 14th Squad Management'
            });
        });
    });
});

// Logs anzeigen (nur Admin)
app.get('/logs', requireAuth('admin'), (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 100;
    const offset = (page - 1) * limit;
    
    db.all(`
        SELECT wl.*, wu.username 
        FROM web_logs wl 
        LEFT JOIN web_users wu ON wl.user_id = wu.id 
        ORDER BY wl.timestamp DESC 
        LIMIT ? OFFSET ?
    `, [limit, offset], (err, logs) => {
        if (err) {
            console.error('Logs query error:', err);
            logs = [];
        }
        
        db.get(`SELECT COUNT(*) as count FROM web_logs`, (err, count) => {
            if (err) {
                console.error('Logs count error:', err);
                count = { count: 0 };
            }
            
            const totalPages = Math.ceil(count.count / limit);
            
            res.render('logs', { 
                user: req.session.user,
                logs: logs || [],
                currentPage: page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                title: 'Web Logs - 14th Squad Management'
            });
        });
    });
});

// Neuen Web-Benutzer erstellen (nur Admin)
app.post('/users/web/create', requireAuth('admin'), async (req, res) => {
    const { username, password, role } = req.body;
    
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (username.length < 3) {
        return res.status(400).json({ error: 'Benutzername muss mindestens 3 Zeichen lang sein' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
    }
    
    if (!['admin', 'mod'].includes(role)) {
        return res.status(400).json({ error: 'Ungültige Rolle' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const uniquePassword = crypto.randomBytes(6).toString('hex').toUpperCase();
        
        db.run(`INSERT INTO web_users (username, password_hash, role, unique_password, created_at) 
                VALUES (?, ?, ?, ?, ?)`,
            [username, passwordHash, role, uniquePassword, new Date().toISOString()],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                        return res.status(400).json({ error: 'Benutzername bereits vergeben' });
                    }
                    return res.status(500).json({ error: 'Datenbankfehler' });
                }
                
                logWebAction(req.session.user.id, 'CREATE_WEB_USER', 
                    `Neuer Web-Benutzer erstellt: ${username} (${role})`);
                
                res.json({ 
                    success: true, 
                    message: 'Benutzer erstellt',
                    uniquePassword: uniquePassword
                });
            }
        );
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
    }
});

// Importiere API-Routen
const apiRoutes = require('./api');
app.use('/api', apiRoutes);

// Error Handling
app.use('/api/*', (req, res) => {
    res.status(404).json({ 
        error: 'API-Endpunkt nicht gefunden',
        path: req.path,
        method: req.method
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    
    if (req.session && req.session.user) {
        logWebAction(req.session.user.id, 'ERROR', `Server Error: ${err.message}`);
    }
    
    if (req.path.startsWith('/api/')) {
        res.status(500).json({ error: 'Interner Serverfehler' });
    } else {
        res.status(500).render('error', { 
            error: 'Etwas ist schiefgelaufen!',
            layout: false
        });
    }
});

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API-Endpunkt nicht gefunden' });
    } else {
        res.status(404).render('error', { 
            error: 'Seite nicht gefunden',
            layout: false
        });
    }
});

// Graceful Shutdown Handler
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

// Server starten
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log('🚀 ===================================');
    console.log('🎮 14th Squad Management System');
    console.log('🚀 ===================================');
    console.log(`🌐 Web-Interface läuft auf Port ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🔐 Login: http://localhost:${PORT}/login`);
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

// Exportiere Funktionen für API
module.exports = { 
    app, 
    db, 
    requireAuth, 
    logWebAction, 
    sendCommandToBot, 
    waitForCommandResult 
};