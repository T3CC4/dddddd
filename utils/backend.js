/**
 * Backend Utility Functions
 * Zentrale Sammlung aller Backend-Utility-Funktionen
 */

const sqlite3 = require('sqlite3').verbose();

// Shared database reference - wird von server.js/api.js gesetzt
let db = null;

function setDatabase(database) {
    db = database;
}

/**
 * Zeit-Formatierung für "vor X Minuten" etc.
 */
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

/**
 * Loggt Web-Aktionen in die Datenbank
 */
function logWebAction(userId, action, details) {
    if (!db) {
        console.error('Database not initialized for logWebAction');
        return;
    }
    
    db.run(`INSERT INTO web_logs (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)`,
        [userId, action, details, new Date().toISOString()],
        (err) => {
            if (err) {
                console.error('Error logging web action:', err);
            }
        }
    );
}

/**
 * Sendet Command an Bot
 */
function sendCommandToBot(commandType, targetId, parameters = null) {
    if (!db) {
        return Promise.reject(new Error('Database not initialized'));
    }
    
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

/**
 * Wartet auf Bot-Command Ergebnis
 */
function waitForCommandResult(commandId, timeout = 30000) {
    if (!db) {
        return Promise.reject(new Error('Database not initialized'));
    }
    
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

/**
 * Auth Middleware für Express
 */
function requireAuth(requiredRole = 'mod') {
    return (req, res, next) => {
        if (!req.session.user) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Nicht authentifiziert' });
            } else {
                return res.redirect('/login');
            }
        }

        if (requiredRole === 'admin' && req.session.user.role !== 'admin') {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
            } else {
                return res.status(403).render('error', { 
                    error: 'Zugriff verweigert. Admin-Berechtigung erforderlich.',
                    layout: false
                });
            }
        }

        next();
    };
}

/**
 * Allgemeine Datenbank Query Helper
 */
const queryHelpers = {
    /**
     * Erstellt standardisierte Activity Query
     */
    getActivitiesQuery: (limit = 10) => {
        return {
            query: `
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
            `,
            params: [limit]
        };
    },

    /**
     * Formatiert Activity für Frontend
     */
    formatActivities: (activities) => {
        return (activities || []).map(activity => {
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
    }
};

/**
 * Response Helper für API
 */
const responseHelpers = {
    success: (res, data, message = null) => {
        const response = { success: true };
        if (data) response.data = data;
        if (message) response.message = message;
        res.json(response);
    },

    error: (res, message, statusCode = 500, details = null) => {
        const response = { error: message };
        if (details) response.details = details;
        res.status(statusCode).json(response);
    },

    notFound: (res, resource = 'Ressource') => {
        res.status(404).json({ error: `${resource} nicht gefunden` });
    },

    unauthorized: (res, message = 'Nicht authentifiziert') => {
        res.status(401).json({ error: message });
    },

    forbidden: (res, message = 'Zugriff verweigert') => {
        res.status(403).json({ error: message });
    }
};

/**
 * Validation Helpers
 */
const validationHelpers = {
    validate: {
        username(username) {
            if (!username || username.length < 3) {
                return 'Benutzername muss mindestens 3 Zeichen lang sein';
            }
            if (username.length > 50) {
                return 'Benutzername darf maximal 50 Zeichen lang sein';
            }
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                return 'Benutzername darf nur Buchstaben, Zahlen und Unterstriche enthalten';
            }
            return null;
        },

        password(password) {
            if (!password || password.length < 6) {
                return 'Passwort muss mindestens 6 Zeichen lang sein';
            }
            return null;
        },

        required(value, fieldName = 'Feld') {
            if (!value || (typeof value === 'string' && value.trim() === '')) {
                return `${fieldName} ist erforderlich`;
            }
            return null;
        }
    },

    isValidId: (id) => {
        return id && typeof id === 'string' && id.trim().length > 0;
    },

    isValidUsername: (username) => {
        return username && 
               typeof username === 'string' && 
               username.length >= 3 && 
               username.length <= 50 &&
               /^[a-zA-Z0-9_]+$/.test(username);
    },

    isValidPassword: (password) => {
        return password && 
               typeof password === 'string' && 
               password.length >= 6;
    },

    isValidRole: (role) => {
        return ['admin', 'mod'].includes(role);
    },

    sanitizeInput: (input) => {
        if (typeof input !== 'string') return input;
        return input.trim().replace(/[<>]/g, '');
    }
};

/**
 * Database Helpers
 */
const dbHelpers = {
    /**
     * Promise-basierte Datenbankabfrage
     */
    query: (sql, params = []) => {
        if (!db) {
            return Promise.reject(new Error('Database not initialized'));
        }

        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    },

    /**
     * Promise-basierte einzelne Zeile
     */
    get: (sql, params = []) => {
        if (!db) {
            return Promise.reject(new Error('Database not initialized'));
        }

        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    },

    /**
     * Promise-basierte Insert/Update/Delete
     */
    run: (sql, params = []) => {
        if (!db) {
            return Promise.reject(new Error('Database not initialized'));
        }

        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes
                    });
                }
            });
        });
    }
};

module.exports = {
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
};