/* ========================================
   14TH SQUAD - USERS.JS
   User Management JavaScript mit Placeholder-Implementierungen
   ======================================== */

let currentUserId = null;
let currentModerationAction = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    loadAllUserStats();
    initializeFeatureFlags();
    
    // Auto-refresh stats every 30 seconds
    setInterval(loadAllUserStats, 30000);
});

// Feature Flags für nicht implementierte Features
const FEATURES = {
    DISCORD_MODERATION: false,      // Discord Bot API Integration
    WEB_USER_LOGS: false,          // Advanced Logging
    SESSION_MANAGEMENT: false,      // Session Tracking
    ROLE_MANAGEMENT: false,        // Advanced Role Changes
    VERIFICATION_RESET: false      // Discord Verification Reset
};

// Initialize Feature Flags
function initializeFeatureFlags() {
    // Disable buttons for unimplemented features
    if (!FEATURES.DISCORD_MODERATION) {
        document.querySelectorAll('[onclick*="moderateUser"]').forEach(btn => {
            btn.disabled = true;
            btn.title = 'Discord Moderation - Coming Soon';
            btn.style.opacity = '0.5';
        });
    }
    
    if (!FEATURES.WEB_USER_LOGS) {
        document.querySelectorAll('[onclick*="showWebUserLogs"]').forEach(btn => {
            btn.disabled = true;
            btn.title = 'Web User Logs - Coming Soon';
            btn.style.opacity = '0.5';
        });
    }
    
    if (!FEATURES.SESSION_MANAGEMENT) {
        document.querySelectorAll('[onclick*="showWebUserSessions"]').forEach(btn => {
            btn.disabled = true;
            btn.title = 'Session Management - Coming Soon';
            btn.style.opacity = '0.5';
        });
    }
}

// ================================
// USER STATISTICS
// ================================

function loadAllUserStats() {
    const discordUsers = document.querySelectorAll('.discord-user-row');
    
    discordUsers.forEach(row => {
        const userId = row.querySelector('code').textContent;
        loadUserStats(userId);
    });
}

function loadUserStats(userId) {
    const statsContainer = document.getElementById(`activity-${userId}`);
    if (!statsContainer) return;
    
    fetch(`/api/users/discord/${userId}/details`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                statsContainer.innerHTML = '<span class="text-muted">Fehler beim Laden</span>';
                return;
            }
            
            const stats = data.stats;
            statsContainer.innerHTML = `
                <div class="stat-item" title="Nachrichten">
                    <i class="fas fa-comment"></i> ${stats.message_count}
                </div>
                <div class="stat-item" title="Tickets">
                    <i class="fas fa-ticket-alt"></i> ${stats.ticket_count}
                </div>
                <div class="stat-item" title="Voice Channels">
                    <i class="fas fa-microphone"></i> ${stats.voice_channel_count}
                </div>
            `;
        })
        .catch(error => {
            console.error('Error loading user stats:', error);
            statsContainer.innerHTML = '<span class="text-muted">Fehler</span>';
        });
}

// ================================
// FILTERING
// ================================

function filterDiscordUsers() {
    const searchTerm = document.getElementById('discordSearch').value.toLowerCase();
    const statusFilter = document.getElementById('discordFilter').value;
    const rows = document.querySelectorAll('.discord-user-row');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const searchData = row.getAttribute('data-search');
        const status = row.getAttribute('data-status');
        
        const searchMatch = !searchTerm || searchData.includes(searchTerm);
        const statusMatch = !statusFilter || status === statusFilter;
        
        if (searchMatch && statusMatch) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    // Update tab count
    const tab = document.getElementById('discord-users-tab');
    if (tab) {
        tab.innerHTML = `<i class="fab fa-discord"></i> Discord Benutzer (${visibleCount})`;
    }
}

function filterWebUsers() {
    const roleFilter = document.getElementById('webUserFilter').value;
    const rows = document.querySelectorAll('.web-user-row');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const role = row.getAttribute('data-role');
        
        if (!roleFilter || role === roleFilter) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    // Update tab count
    const tab = document.getElementById('web-users-tab');
    if (tab) {
        tab.innerHTML = `<i class="fas fa-globe"></i> Web Benutzer (${visibleCount})`;
    }
}

// ================================
// WEB USER MANAGEMENT (IMPLEMENTED)
// ================================

function showCreateWebUserModal() {
    const form = document.getElementById('createWebUserForm');
    const result = document.getElementById('createUserResult');
    
    if (form) form.reset();
    if (result) result.innerHTML = '';
    
    const modal = new bootstrap.Modal(document.getElementById('createWebUserModal'));
    modal.show();
}

function createWebUser() {
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    const resultDiv = document.getElementById('createUserResult');
    
    if (!username || !password || !role) {
        resultDiv.innerHTML = '<div class="alert alert-danger">Alle Felder sind erforderlich!</div>';
        return;
    }
    
    if (username.length < 3) {
        resultDiv.innerHTML = '<div class="alert alert-danger">Benutzername muss mindestens 3 Zeichen lang sein!</div>';
        return;
    }
    
    if (password.length < 6) {
        resultDiv.innerHTML = '<div class="alert alert-danger">Passwort muss mindestens 6 Zeichen lang sein!</div>';
        return;
    }
    
    fetch('/users/web/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            resultDiv.innerHTML = `
                <div class="alert alert-success">
                    <strong><i class="fas fa-check"></i> Benutzer erfolgreich erstellt!</strong><br>
                    <div class="mt-2 p-2" style="background: rgba(255, 0, 102, 0.1); border-radius: 8px;">
                        <strong>Login-Daten:</strong><br>
                        Benutzername: <code>${username}</code><br>
                        Unique Password: <code>${data.uniquePassword}</code><br>
                        <small class="text-warning">
                            <i class="fas fa-exclamation-triangle"></i> 
                            Teile das Unique Password sicher mit dem Benutzer!
                        </small>
                    </div>
                </div>
            `;
            setTimeout(() => location.reload(), 3000);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-times"></i> ${data.error}</div>`;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        resultDiv.innerHTML = '<div class="alert alert-danger">Fehler beim Erstellen des Benutzers</div>';
    });
}

function resetPassword(userId) {
    currentUserId = userId;
    const form = document.getElementById('passwordResetForm');
    const result = document.getElementById('passwordResetResult');
    
    if (form) form.reset();
    if (result) result.innerHTML = '';
    
    const modal = new bootstrap.Modal(document.getElementById('passwordResetModal'));
    modal.show();
}

function confirmPasswordReset() {
    const password = document.getElementById('resetPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const resultDiv = document.getElementById('passwordResetResult');
    
    if (!password || !confirm) {
        resultDiv.innerHTML = '<div class="alert alert-danger">Beide Felder sind erforderlich!</div>';
        return;
    }
    
    if (password !== confirm) {
        resultDiv.innerHTML = '<div class="alert alert-danger">Passwörter stimmen nicht überein!</div>';
        return;
    }
    
    if (password.length < 6) {
        resultDiv.innerHTML = '<div class="alert alert-danger">Passwort muss mindestens 6 Zeichen lang sein!</div>';
        return;
    }
    
    fetch(`/api/users/web/${currentUserId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            resultDiv.innerHTML = '<div class="alert alert-success">Passwort erfolgreich zurückgesetzt!</div>';
            setTimeout(() => {
                bootstrap.Modal.getInstance(document.getElementById('passwordResetModal')).hide();
            }, 2000);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        resultDiv.innerHTML = '<div class="alert alert-danger">Fehler beim Zurücksetzen des Passworts</div>';
    });
}

function regenerateUniquePassword(userId) {
    if (confirm('Möchtest du das Unique Password neu generieren?')) {
        fetch(`/api/users/web/${userId}/regenerate-unique`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast(`Neues Unique Password: ${data.uniquePassword}`, 'success');
                setTimeout(() => location.reload(), 2000);
            } else {
                showToast(data.error || 'Fehler beim Regenerieren', 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToast('Fehler beim Regenerieren', 'error');
        });
    }
}

function deleteWebUser(userId) {
    if (confirm('Bist du sicher, dass du diesen Benutzer löschen möchtest?')) {
        fetch(`/api/users/web/${userId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('Benutzer erfolgreich gelöscht!', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showToast(data.error || 'Fehler beim Löschen', 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToast('Fehler beim Löschen', 'error');
        });
    }
}

// ================================
// DISCORD USER MANAGEMENT (IMPLEMENTED)
// ================================

function showUserDetails(userId) {
    const contentDiv = document.getElementById('userDetailsContent');
    
    contentDiv.innerHTML = `
        <div class="text-center">
            <i class="fas fa-spinner fa-spin fa-2x"></i>
            <p>Lade Benutzer-Details...</p>
        </div>
    `;
    
    const modal = new bootstrap.Modal(document.getElementById('userDetailsModal'));
    modal.show();
    
    fetch(`/api/users/discord/${userId}/details`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                contentDiv.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                return;
            }
            
            const user = data.user;
            const stats = data.stats;
            const activities = data.activities;
            
            contentDiv.innerHTML = `
                <div class="row mb-4">
                    <div class="col-md-4 text-center">
                        <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png" 
                             alt="${user.username}" class="user-avatar mb-2" style="width: 80px; height: 80px;">
                        <h5>${user.username}</h5>
                        <span class="badge bg-${user.verified ? 'success' : 'warning'}">
                            ${user.verified ? 'Verifiziert' : 'Ausstehend'}
                        </span>
                    </div>
                    <div class="col-md-8">
                        <h6><i class="fas fa-info-circle"></i> Grundinformationen</h6>
                        <table class="table table-sm table-dark">
                            <tr><td><strong>User ID:</strong></td><td><code>${user.id}</code></td></tr>
                            <tr><td><strong>Beigetreten:</strong></td><td>${new Date(user.joined_at).toLocaleString('de-DE')}</td></tr>
                            <tr><td><strong>Verifikationscode:</strong></td><td>${user.verification_code || 'N/A'}</td></tr>
                            <tr><td><strong>Persönlicher Channel:</strong></td><td>${user.personal_channel_id || 'Keiner'}</td></tr>
                        </table>
                    </div>
                </div>
                
                <div class="row mb-4">
                    <div class="col-md-12">
                        <h6><i class="fas fa-chart-bar"></i> Statistiken</h6>
                        <div class="row">
                            <div class="col-md-4">
                                <div class="stat-card text-center p-3" style="background: rgba(255, 0, 102, 0.1); border-radius: 8px;">
                                    <h4>${stats.message_count}</h4>
                                    <small>Nachrichten</small>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="stat-card text-center p-3" style="background: rgba(255, 170, 0, 0.1); border-radius: 8px;">
                                    <h4>${stats.ticket_count}</h4>
                                    <small>Tickets</small>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="stat-card text-center p-3" style="background: rgba(0, 170, 255, 0.1); border-radius: 8px;">
                                    <h4>${stats.voice_channel_count}</h4>
                                    <small>Voice Channels</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-12">
                        <h6><i class="fas fa-history"></i> Letzte Aktivitäten</h6>
                        <div class="activity-list" style="max-height: 200px; overflow-y: auto;">
                            ${activities.length > 0 ? 
                                activities.map(activity => `
                                    <div class="activity-item p-2 mb-2" style="background: rgba(255, 255, 255, 0.05); border-radius: 4px;">
                                        <i class="fas fa-${activity.type === 'message' ? 'comment' : 'ticket-alt'}"></i>
                                        ${activity.type === 'message' ? 'Nachricht in' : 'Ticket erstellt:'} 
                                        <strong>${activity.channel_name}</strong>
                                        <small class="text-muted float-end">
                                            ${new Date(activity.timestamp).toLocaleString('de-DE')}
                                        </small>
                                    </div>
                                `).join('') : 
                                '<p class="text-muted">Keine Aktivitäten gefunden.</p>'
                            }
                        </div>
                    </div>
                </div>
            `;
        })
        .catch(error => {
            console.error('Error:', error);
            contentDiv.innerHTML = '<div class="alert alert-danger">Fehler beim Laden der Details</div>';
        });
}

function verifyUser(userId) {
    if (confirm('Möchtest du diesen Benutzer manuell verifizieren?')) {
        fetch(`/api/users/discord/${userId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('Benutzer erfolgreich verifiziert!', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                showToast(data.error || 'Fehler bei der Verifikation', 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToast('Fehler bei der Verifikation', 'error');
        });
    }
}

// ================================
// PLACEHOLDER IMPLEMENTATIONS (NOT IMPLEMENTED)
// ================================

function moderateUser(userId, action) {
    if (!FEATURES.DISCORD_MODERATION) {
        showNotImplementedDialog('Discord Moderation', 
            'Diese Funktion erfordert eine Discord Bot API Integration. ' +
            'Folgende Features werden in einer zukünftigen Version verfügbar sein:\n\n' +
            '• Benutzer kicken/bannen\n' +
            '• Timeout vergeben\n' +
            '• Rollen verwalten\n' +
            '• Kanäle moderieren'
        );
        return;
    }
    
    // Original implementation would go here
    currentUserId = userId;
    currentModerationAction = action;
    // ... rest of moderation logic
}

function changeRole(userId, currentRole) {
    if (!FEATURES.ROLE_MANAGEMENT) {
        showNotImplementedDialog('Erweiterte Rollenverwaltung',
            'Automatische Rollenänderungen sind noch nicht implementiert. ' +
            'Bitte ändere Rollen manuell in der Datenbank oder warte auf ein zukünftiges Update.'
        );
        return;
    }
    
    // Implementation placeholder
    showToast('Rollenverwaltung wird implementiert...', 'info');
}

function showWebUserLogs(userId) {
    if (!FEATURES.WEB_USER_LOGS) {
        showNotImplementedDialog('Web User Activity Logs',
            'Detaillierte Aktivitätslogs für Web-Benutzer sind in Entwicklung. ' +
            'Diese Funktion wird folgende Informationen enthalten:\n\n' +
            '• Login/Logout Historie\n' +
            '• Durchgeführte Aktionen\n' +
            '• IP-Adressen und Browser\n' +
            '• Zeitstempel aller Aktivitäten'
        );
        return;
    }
    
    // Implementation placeholder
    showToast('Activity Logs werden geladen...', 'info');
}

function showWebUserSessions(userId) {
    if (!FEATURES.SESSION_MANAGEMENT) {
        showNotImplementedDialog('Session Management',
            'Erweiterte Session-Verwaltung ist noch nicht verfügbar. ' +
            'Geplante Features:\n\n' +
            '• Aktive Sessions anzeigen\n' +
            '• Remote Session Termination\n' +
            '• Geräte-Informationen\n' +
            '• Session-Sicherheit'
        );
        return;
    }
    
    // Implementation placeholder
    showToast('Session Management wird geladen...', 'info');
}

function resetVerification(userId) {
    if (!FEATURES.VERIFICATION_RESET) {
        showNotImplementedDialog('Verifikation zurücksetzen',
            'Das Zurücksetzen der Discord-Verifikation erfordert Bot-Integration. ' +
            'Bitte verwende vorerst Discord-Commands direkt oder kontaktiere einen Administrator.'
        );
        return;
    }
    
    // Implementation placeholder
    showToast('Verifikation wird zurückgesetzt...', 'info');
}

function deletePersonalChannel(userId) {
    if (!FEATURES.DISCORD_MODERATION) {
        showNotImplementedDialog('Personal Channel Management',
            'Das Löschen persönlicher Kanäle erfordert Discord Bot API Integration. ' +
            'Diese Funktion wird in einer zukünftigen Version verfügbar sein.'
        );
        return;
    }
    
    // Implementation placeholder
    showToast('Channel-Management wird implementiert...', 'info');
}

// ================================
// UTILITY FUNCTIONS
// ================================

function openDiscordProfile(userId) {
    const discordUrl = `https://discord.com/users/${userId}`;
    window.open(discordUrl, '_blank');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('In Zwischenablage kopiert!', 'success');
    }).catch(() => {
        showToast('Fehler beim Kopieren', 'error');
    });
}

function refreshUserData() {
    showToast('Daten werden aktualisiert...', 'info');
    loadAllUserStats();
    setTimeout(() => {
        showToast('Daten aktualisiert!', 'success');
    }, 1000);
}

function exportUsers() {
    const discordData = Array.from(document.querySelectorAll('.discord-user-row')).map(row => {
        const username = row.querySelector('.username strong').textContent;
        const userId = row.querySelector('code').textContent;
        const status = row.querySelector('.badge').textContent.trim();
        const joinDate = row.querySelector('.join-date').textContent;
        return `"${username}","${userId}","${status}","${joinDate}","Discord"`;
    });
    
    const webData = Array.from(document.querySelectorAll('.web-user-row')).map(row => {
        const username = row.querySelector('.username strong').textContent;
        const role = row.querySelector('.role-badge').textContent.trim();
        const created = row.querySelector('.created-date').textContent.split('\n')[1];
        const lastLogin = row.querySelector('.last-login').textContent.split('\n')[1];
        return `"${username}","N/A","${role}","${created}","Web","${lastLogin}"`;
    });
    
    let csv = 'Benutzername,User ID,Status/Rolle,Erstellt/Beigetreten,Typ,Letzter Login\n';
    csv += discordData.join('\n') + '\n';
    csv += webData.join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `14th_squad_users_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ================================
// UI HELPER FUNCTIONS
// ================================

function showNotImplementedDialog(featureName, description) {
    const alertHtml = `
        <div class="alert alert-info alert-dismissible fade show" role="alert">
            <h6><i class="fas fa-info-circle"></i> ${featureName}</h6>
            <p style="margin-bottom: 0; white-space: pre-line;">${description}</p>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    // Insert at top of page
    const container = document.querySelector('.main-content') || document.body;
    container.insertAdjacentHTML('afterbegin', alertHtml);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
        const alert = container.querySelector('.alert');
        if (alert) {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }
    }, 10000);
}

function showToast(message, type = 'info') {
    const toastContainer = getOrCreateToastContainer();
    const toastId = 'toast-' + Date.now();
    
    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'times' : 'info'}"></i>
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 3000 });
    toast.show();
    
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }
    return container;
}

// ================================
// EVENT LISTENERS
// ================================

// Real-time search for Discord users
document.getElementById('discordSearch')?.addEventListener('input', filterDiscordUsers);

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + F für Suche
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.getElementById('discordSearch');
        if (searchInput) {
            searchInput.focus();
        }
    }
    
    // Escape um Modals zu schließen
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) {
                modalInstance.hide();
            }
        });
    }
    
    // Ctrl/Cmd + N für neuen Benutzer
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showCreateWebUserModal();
    }
    
    // Ctrl/Cmd + E für Export
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportUsers();
    }
    
    // Ctrl/Cmd + R für Refresh
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        refreshUserData();
    }
});

// ================================
// ADVANCED FEATURES (PLACEHOLDER IMPLEMENTATIONS)
// ================================

// Future Implementation: Advanced Search
function advancedUserSearch(criteria) {
    // TODO: Implement advanced search with multiple criteria
    console.log('Advanced search not yet implemented:', criteria);
    showToast('Erweiterte Suche wird in einer zukünftigen Version verfügbar sein', 'info');
}

// Future Implementation: Bulk Operations
function bulkUserOperations(action, userIds) {
    // TODO: Implement bulk operations for multiple users
    console.log('Bulk operations not yet implemented:', action, userIds);
    showToast('Bulk-Operationen werden in einer zukünftigen Version verfügbar sein', 'info');
}

// Future Implementation: User Analytics
function generateUserAnalytics() {
    // TODO: Generate detailed analytics about user behavior
    console.log('User analytics not yet implemented');
    showToast('Benutzer-Analytik wird in einer zukünftigen Version verfügbar sein', 'info');
}

// Future Implementation: Advanced Permissions
function manageAdvancedPermissions(userId, permissions) {
    // TODO: Implement granular permission management
    console.log('Advanced permissions not yet implemented:', userId, permissions);
    showToast('Erweiterte Berechtigungen werden in einer zukünftigen Version verfügbar sein', 'info');
}

// ================================
// DEBUG & DEVELOPMENT HELPERS
// ================================

// Development helper: Log feature flags
function logFeatureFlags() {
    console.group('14th Squad - Feature Flags');
    Object.entries(FEATURES).forEach(([feature, enabled]) => {
        console.log(`${feature}: ${enabled ? '✅ Enabled' : '❌ Disabled'}`);
    });
    console.groupEnd();
}

// Development helper: Test all toast types
function testToasts() {
    showToast('Success message', 'success');
    setTimeout(() => showToast('Error message', 'error'), 1000);
    setTimeout(() => showToast('Info message', 'info'), 2000);
    setTimeout(() => showToast('Warning message', 'warning'), 3000);
}

// Development helper: Simulate API calls
function simulateApiCall(endpoint, method = 'GET', data = null) {
    console.log(`Simulating API call: ${method} ${endpoint}`, data);
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({ success: true, message: 'Simulated response' });
        }, 1000);
    });
}

// ================================
// INITIALIZATION & CLEANUP
// ================================

// Page initialization
function initializePage() {
    console.log('14th Squad User Management - Initializing...');
    
    // Log feature status
    if (window.location.search.includes('debug=true')) {
        logFeatureFlags();
    }
    
    // Initialize tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Initialize popovers
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });
    
    console.log('14th Squad User Management - Ready!');
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    // Clear any running intervals
    // Cleanup event listeners if needed
    console.log('14th Squad User Management - Cleanup complete');
});

// Auto-run initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}

// ================================
// API INTEGRATION HELPERS
// ================================

// Helper for consistent API calls
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    if (data) {
        options.body = JSON.stringify(data);
    }
    
    try {
        const response = await fetch(endpoint, options);
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || `HTTP ${response.status}`);
        }
        
        return result;
    } catch (error) {
        console.error(`API call failed: ${method} ${endpoint}`, error);
        throw error;
    }
}

// Helper for handling API errors consistently
function handleApiError(error, context = '') {
    console.error(`API Error ${context}:`, error);
    
    if (error.message.includes('401')) {
        showToast('Sitzung abgelaufen. Bitte melde dich erneut an.', 'error');
        setTimeout(() => window.location.href = '/login', 2000);
    } else if (error.message.includes('403')) {
        showToast('Keine Berechtigung für diese Aktion.', 'error');
    } else if (error.message.includes('404')) {
        showToast('Ressource nicht gefunden.', 'error');
    } else if (error.message.includes('500')) {
        showToast('Serverfehler. Bitte versuche es später erneut.', 'error');
    } else {
        showToast(error.message || 'Ein unbekannter Fehler ist aufgetreten.', 'error');
    }
}

// ================================
// FEATURE FLAG MANAGEMENT
// ================================

// Update feature flags (for future use)
function updateFeatureFlags(newFlags) {
    Object.assign(FEATURES, newFlags);
    initializeFeatureFlags();
    console.log('Feature flags updated:', FEATURES);
}

// Check if feature is enabled
function isFeatureEnabled(featureName) {
    return FEATURES[featureName] === true;
}

// Enable a specific feature
function enableFeature(featureName) {
    if (FEATURES.hasOwnProperty(featureName)) {
        FEATURES[featureName] = true;
        initializeFeatureFlags();
        showToast(`Feature "${featureName}" aktiviert!`, 'success');
    } else {
        console.warn(`Unknown feature: ${featureName}`);
    }
}

// Disable a specific feature
function disableFeature(featureName) {
    if (FEATURES.hasOwnProperty(featureName)) {
        FEATURES[featureName] = false;
        initializeFeatureFlags();
        showToast(`Feature "${featureName}" deaktiviert!`, 'warning');
    } else {
        console.warn(`Unknown feature: ${featureName}`);
    }
}

// ================================
// EXPORT FOR POTENTIAL MODULE USE
// ================================

// If this script is ever converted to a module, export the main functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // Main functions
        loadAllUserStats,
        filterDiscordUsers,
        filterWebUsers,
        createWebUser,
        verifyUser,
        showUserDetails,
        
        // Utility functions
        showToast,
        copyToClipboard,
        refreshUserData,
        exportUsers,
        
        // Feature management
        isFeatureEnabled,
        enableFeature,
        disableFeature,
        
        // API helpers
        apiCall,
        handleApiError
    };
}

// Make some functions globally available for debugging
window.SquadUserManagement = {
    testToasts,
    logFeatureFlags,
    enableFeature,
    disableFeature,
    simulateApiCall
};