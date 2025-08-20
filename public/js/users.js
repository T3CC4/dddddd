let currentUserId = null;
let currentModerationAction = null;

document.addEventListener('DOMContentLoaded', function() {
    loadAllUserStats();
 
    setInterval(loadAllUserStats, 30000);
    
    setupEventListeners();
});

function setupEventListeners() {
    const discordSearch = document.getElementById('discordSearch');
    if (discordSearch) {
        discordSearch.addEventListener('input', filterDiscordUsers);
    }

    const discordFilter = document.getElementById('discordFilter');
    if (discordFilter) {
        discordFilter.addEventListener('change', filterDiscordUsers);
    }
    
    const webUserFilter = document.getElementById('webUserFilter');
    if (webUserFilter) {
        webUserFilter.addEventListener('change', filterWebUsers);
    }

    document.addEventListener('keydown', handleKeyboardShortcuts);
}

function loadAllUserStats() {
    const discordUsers = document.querySelectorAll('.discord-user-row');
    
    discordUsers.forEach(row => {
        const userIdElement = row.querySelector('code');
        if (userIdElement) {
            const userId = userIdElement.textContent;
            loadUserStats(userId);
        }
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
                    <i class="fas fa-comment"></i> ${stats.message_count || 0}
                </div>
                <div class="stat-item" title="Tickets">
                    <i class="fas fa-ticket-alt"></i> ${stats.ticket_count || 0}
                </div>
                <div class="stat-item" title="Voice Channels">
                    <i class="fas fa-microphone"></i> ${stats.voice_channel_count || 0}
                </div>
            `;
        })
        .catch(error => {
            console.error('Error loading user stats:', error);
            statsContainer.innerHTML = '<span class="text-muted">Fehler</span>';
        });
}

function filterDiscordUsers() {
    const searchInput = document.getElementById('discordSearch');
    const filterSelect = document.getElementById('discordFilter');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const statusFilter = filterSelect ? filterSelect.value : '';
    
    const rows = document.querySelectorAll('.discord-user-row');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const searchData = row.getAttribute('data-search') || '';
        const status = row.getAttribute('data-status') || '';
        
        const searchMatch = !searchTerm || searchData.includes(searchTerm);
        const statusMatch = !statusFilter || status === statusFilter;
        
        if (searchMatch && statusMatch) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    const tab = document.getElementById('discord-users-tab');
    if (tab) {
        const originalText = tab.innerHTML;
        const match = originalText.match(/^(.*)\(\d+\)(.*)$/);
        if (match) {
            tab.innerHTML = `${match[1]}(${visibleCount})${match[2] || ''}`;
        }
    }
}

function filterWebUsers() {
    const filterSelect = document.getElementById('webUserFilter');
    const roleFilter = filterSelect ? filterSelect.value : '';
    
    const rows = document.querySelectorAll('.web-user-row');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const role = row.getAttribute('data-role') || '';
        
        if (!roleFilter || role === roleFilter) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    const tab = document.getElementById('web-users-tab');
    if (tab) {
        const originalText = tab.innerHTML;
        const match = originalText.match(/^(.*)\(\d+\)(.*)$/);
        if (match) {
            tab.innerHTML = `${match[1]}(${visibleCount})${match[2] || ''}`;
        }
    }
}

function showCreateWebUserModal() {
    const form = document.getElementById('createWebUserForm');
    const result = document.getElementById('createUserResult');
    
    if (form) form.reset();
    if (result) result.innerHTML = '';
    
    const modal = new bootstrap.Modal(document.getElementById('createWebUserModal'));
    modal.show();
}

function createWebUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    const resultDiv = document.getElementById('createUserResult');
    
    if (!username || !password || !role) {
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Alle Felder sind erforderlich!</div>';
        return;
    }
    
    if (username.length < 3) {
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Benutzername muss mindestens 3 Zeichen lang sein!</div>';
        return;
    }
    
    if (password.length < 6) {
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Passwort muss mindestens 6 Zeichen lang sein!</div>';
        return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Benutzername darf nur Buchstaben, Zahlen und Unterstriche enthalten!</div>';
        return;
    }
    
    resultDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Erstelle Benutzer...</div>';
    
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
                    <strong><i class="fas fa-check-circle"></i> Benutzer erfolgreich erstellt!</strong><br>
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
            
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-times-circle"></i> ${data.error}</div>`;
        }
    })
    .catch(error => {
        console.error('Error creating user:', error);
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-times-circle"></i> Fehler beim Erstellen des Benutzers</div>';
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
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Beide Felder sind erforderlich!</div>';
        return;
    }
    
    if (password !== confirm) {
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Passwörter stimmen nicht überein!</div>';
        return;
    }
    
    if (password.length < 6) {
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Passwort muss mindestens 6 Zeichen lang sein!</div>';
        return;
    }

    resultDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Passwort wird zurückgesetzt...</div>';
    
    fetch(`/api/users/web/${currentUserId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            resultDiv.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Passwort erfolgreich zurückgesetzt!</div>';
            setTimeout(() => {
                const modal = bootstrap.Modal.getInstance(document.getElementById('passwordResetModal'));
                if (modal) modal.hide();
            }, 2000);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-times-circle"></i> ${data.error}</div>`;
        }
    })
    .catch(error => {
        console.error('Error resetting password:', error);
        resultDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-times-circle"></i> Fehler beim Zurücksetzen des Passworts</div>';
    });
}

function regenerateUniquePassword(userId) {
    if (!confirm('Möchtest du das Unique Password neu generieren? Das alte wird ungültig!')) {
        return;
    }
    
    fetch(`/api/users/web/${userId}/regenerate-unique`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const alertContent = `
                <div class="alert alert-success" role="alert">
                    <h4 class="alert-heading"><i class="fas fa-check-circle"></i> Unique Password regeneriert!</h4>
                    <p>Das neue Unique Password lautet:</p>
                    <hr>
                    <h3 class="text-center">
                        <code style="font-size: 1.5em; background: rgba(255, 0, 102, 0.1); padding: 10px; border-radius: 8px;">
                            ${data.uniquePassword}
                        </code>
                    </h3>
                    <hr>
                    <p class="mb-0">
                        <i class="fas fa-exclamation-triangle text-warning"></i>
                        <strong>Wichtig:</strong> Teile dieses Password sicher mit dem Benutzer!
                    </p>
                </div>
            `;
            
            showModal('Unique Password regeneriert', alertContent, [
                {
                    text: 'Kopieren',
                    class: 'btn-primary',
                    action: () => copyToClipboard(data.uniquePassword)
                },
                {
                    text: 'Schließen',
                    class: 'btn-secondary',
                    action: () => setTimeout(() => window.location.reload(), 1000)
                }
            ]);
        } else {
            showToast(data.error || 'Fehler beim Regenerieren', 'error');
        }
    })
    .catch(error => {
        console.error('Error regenerating unique password:', error);
        showToast('Fehler beim Regenerieren', 'error');
    });
}

function deleteWebUser(userId) {
    if (!confirm('Bist du sicher, dass du diesen Benutzer löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden!')) {
        return;
    }
    
    fetch(`/api/users/web/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Benutzer erfolgreich gelöscht!', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showToast(data.error || 'Fehler beim Löschen', 'error');
        }
    })
    .catch(error => {
        console.error('Error deleting user:', error);
        showToast('Fehler beim Löschen', 'error');
    });
}

function showUserDetails(userId) {
    const contentDiv = document.getElementById('userDetailsContent');
    
    contentDiv.innerHTML = `
        <div class="text-center">
            <i class="fas fa-spinner fa-spin fa-2x text-primary"></i>
            <p class="mt-2">Lade Benutzer-Details...</p>
        </div>
    `;
    
    const modal = new bootstrap.Modal(document.getElementById('userDetailsModal'));
    modal.show();
    
    fetch(`/api/users/discord/${userId}/details`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                contentDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> ${data.error}</div>`;
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
                            <i class="fas fa-${user.verified ? 'check-circle' : 'clock'}"></i>
                            ${user.verified ? 'Verifiziert' : 'Ausstehend'}
                        </span>
                    </div>
                    <div class="col-md-8">
                        <h6><i class="fas fa-info-circle text-primary"></i> Grundinformationen</h6>
                        <table class="table table-sm table-dark">
                            <tr><td><strong>User ID:</strong></td><td><code>${user.id}</code></td></tr>
                            <tr><td><strong>Beigetreten:</strong></td><td>${new Date(user.joined_at).toLocaleString('de-DE')}</td></tr>
                            <tr><td><strong>Verifikationscode:</strong></td><td>${user.verification_code ? `<code>${user.verification_code}</code>` : 'N/A'}</td></tr>
                            <tr><td><strong>Persönlicher Channel:</strong></td><td>${user.personal_channel_id ? `<code>${user.personal_channel_id}</code>` : 'Keiner'}</td></tr>
                        </table>
                    </div>
                </div>
                
                <div class="row mb-4">
                    <div class="col-md-12">
                        <h6><i class="fas fa-chart-bar text-success"></i> Statistiken</h6>
                        <div class="row">
                            <div class="col-md-4">
                                <div class="stat-card text-center p-3" style="background: rgba(0, 170, 255, 0.1); border-radius: 8px; border-left: 4px solid var(--info-color);">
                                    <h4 class="text-info">${stats.message_count}</h4>
                                    <small>Nachrichten</small>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="stat-card text-center p-3" style="background: rgba(255, 170, 0, 0.1); border-radius: 8px; border-left: 4px solid var(--warning-color);">
                                    <h4 class="text-warning">${stats.ticket_count}</h4>
                                    <small>Tickets</small>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="stat-card text-center p-3" style="background: rgba(255, 0, 102, 0.1); border-radius: 8px; border-left: 4px solid var(--primary-pink);">
                                    <h4 class="text-primary">${stats.voice_channel_count}</h4>
                                    <small>Voice Channels</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-12">
                        <h6><i class="fas fa-history text-warning"></i> Letzte Aktivitäten</h6>
                        <div class="activity-list" style="max-height: 200px; overflow-y: auto;">
                            ${activities.length > 0 ? 
                                activities.map(activity => `
                                    <div class="activity-item p-2 mb-2" style="background: rgba(255, 255, 255, 0.05); border-radius: 4px; border-left: 3px solid var(--primary-pink);">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <div>
                                                <i class="fas fa-${activity.type === 'message' ? 'comment' : 'ticket-alt'} text-primary"></i>
                                                ${activity.type === 'message' ? 'Nachricht in' : 'Ticket erstellt:'} 
                                                <strong class="text-primary">${activity.channel_name}</strong>
                                            </div>
                                            <small class="text-muted">
                                                ${new Date(activity.timestamp).toLocaleString('de-DE')}
                                            </small>
                                        </div>
                                    </div>
                                `).join('') : 
                                '<div class="text-center py-3"><i class="fas fa-inbox fa-2x text-muted mb-2"></i><p class="text-muted">Keine Aktivitäten gefunden.</p></div>'
                            }
                        </div>
                    </div>
                </div>
            `;
        })
        .catch(error => {
            console.error('Error loading user details:', error);
            contentDiv.innerHTML = '<div class="alert alert-danger"><i class="fas fa-times-circle"></i> Fehler beim Laden der Details</div>';
        });
}

function verifyUser(userId) {
    if (!confirm('Möchtest du diesen Benutzer manuell verifizieren?')) {
        return;
    }
    
    fetch(`/api/users/discord/${userId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Benutzer erfolgreich verifiziert!', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showToast(data.error || 'Fehler bei der Verifikation', 'error');
        }
    })
    .catch(error => {
        console.error('Error verifying user:', error);
        showToast('Fehler bei der Verifikation', 'error');
    });
}

function moderateUser(userId, action) {
    currentUserId = userId;
    currentModerationAction = action;
    
    const actionTexts = {
        'kick': { title: 'Benutzer kicken', icon: 'door-open', color: 'warning' },
        'ban': { title: 'Benutzer bannen', icon: 'ban', color: 'danger' },
        'timeout': { title: 'Timeout vergeben', icon: 'clock', color: 'warning' }
    };
    
    const actionConfig = actionTexts[action] || { title: 'Aktion', icon: 'gavel', color: 'secondary' };
    
    const contentDiv = document.getElementById('moderationContent');
    contentDiv.innerHTML = `
        <div class="alert alert-${actionConfig.color}">
            <h5><i class="fas fa-${actionConfig.icon}"></i> ${actionConfig.title}</h5>
            <p>Du bist dabei, eine Moderationsaktion gegen den Benutzer <strong>${userId}</strong> durchzuführen.</p>
        </div>
        
        <form id="moderationForm">
            <div class="mb-3">
                <label for="moderationReason" class="form-label">Grund (optional)</label>
                <textarea class="form-control" id="moderationReason" rows="3" placeholder="Grund für die Aktion..."></textarea>
            </div>
            
            ${action === 'timeout' ? `
            <div class="mb-3">
                <label for="timeoutDuration" class="form-label">Timeout-Dauer (Sekunden)</label>
                <select class="form-select" id="timeoutDuration">
                    <option value="300">5 Minuten</option>
                    <option value="600">10 Minuten</option>
                    <option value="1800">30 Minuten</option>
                    <option value="3600">1 Stunde</option>
                    <option value="7200">2 Stunden</option>
                    <option value="86400">24 Stunden</option>
                </select>
            </div>
            ` : ''}
        </form>
        
        <div class="alert alert-warning">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Warnung:</strong> Diese Aktion wird sofort ausgeführt und kann nicht rückgängig gemacht werden!
        </div>
    `;
    
    const confirmBtn = document.getElementById('confirmModerationBtn');
    confirmBtn.innerHTML = `<i class="fas fa-${actionConfig.icon}"></i> ${actionConfig.title}`;
    confirmBtn.className = `btn btn-${actionConfig.color}`;
    
    const modal = new bootstrap.Modal(document.getElementById('moderationModal'));
    modal.show();
}

function confirmModeration() {
    const reason = document.getElementById('moderationReason').value.trim();
    const duration = document.getElementById('timeoutDuration')?.value;
    
    let endpoint = '';
    let payload = { reason };
    
    switch (currentModerationAction) {
        case 'kick':
            endpoint = `/api/users/discord/${currentUserId}/kick`;
            break;
        case 'ban':
            endpoint = `/api/users/discord/${currentUserId}/ban`;
            break;
        case 'timeout':
            endpoint = `/api/users/discord/${currentUserId}/timeout`;
            payload.duration = parseInt(duration) || 600;
            break;
        default:
            showToast('Unbekannte Aktion', 'error');
            return;
    }
    
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        const modal = bootstrap.Modal.getInstance(document.getElementById('moderationModal'));
        if (modal) modal.hide();
        
        if (data.success) {
            showToast(`Moderation erfolgreich durchgeführt: ${data.message}`, 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showToast(`Moderation fehlgeschlagen: ${data.error}`, 'error');
        }
    })
    .catch(error => {
        console.error('Error performing moderation:', error);
        const modal = bootstrap.Modal.getInstance(document.getElementById('moderationModal'));
        if (modal) modal.hide();
        showToast('Fehler bei der Moderation', 'error');
    });
}

function resetVerification(userId) {
    if (!confirm('Möchtest du die Verifikation für diesen Benutzer zurücksetzen? Ein neuer Verifikationscode wird generiert.')) {
        return;
    }
    
    fetch(`/api/users/discord/${userId}/reset-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const alertContent = `
                <div class="alert alert-success">
                    <h5><i class="fas fa-check-circle"></i> Verifikation zurückgesetzt!</h5>
                    <p>Neuer Verifikationscode: <code style="font-size: 1.2em;">${data.newVerificationCode}</code></p>
                    <hr>
                    <p class="mb-0"><small>Der Benutzer muss sich erneut mit diesem Code verifizieren.</small></p>
                </div>
            `;
            
            showModal('Verifikation zurückgesetzt', alertContent, [
                {
                    text: 'Code kopieren',
                    class: 'btn-primary',
                    action: () => copyToClipboard(data.newVerificationCode)
                },
                {
                    text: 'Schließen',
                    class: 'btn-secondary',
                    action: () => setTimeout(() => window.location.reload(), 1000)
                }
            ]);
        } else {
            showToast(data.error || 'Fehler beim Zurücksetzen', 'error');
        }
    })
    .catch(error => {
        console.error('Error resetting verification:', error);
        showToast('Fehler beim Zurücksetzen der Verifikation', 'error');
    });
}

function deletePersonalChannel(userId) {
    if (!confirm('Möchtest du den persönlichen Channel dieses Benutzers löschen?')) {
        return;
    }
    
    fetch(`/api/users/discord/${userId}/delete-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showToast(data.error || 'Fehler beim Löschen', 'error');
        }
    })
    .catch(error => {
        console.error('Error deleting personal channel:', error);
        showToast('Fehler beim Löschen des Channels', 'error');
    });
}

function changeRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'mod' : 'admin';
    
    if (!confirm(`Möchtest du die Rolle zu "${newRole.toUpperCase()}" ändern?`)) {
        return;
    }
    
    fetch(`/api/users/web/${userId}/change-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newRole })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showToast(data.error || 'Fehler beim Ändern der Rolle', 'error');
        }
    })
    .catch(error => {
        console.error('Error changing role:', error);
        showToast('Fehler beim Ändern der Rolle', 'error');
    });
}

function showWebUserLogs(userId) {
    fetch(`/api/users/web/${userId}/logs`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            
            const logs = data.logs || [];
            const logsList = logs.length > 0 ? 
                logs.map(log => `
                    <div class="log-entry p-2 mb-2" style="background: rgba(255, 255, 255, 0.05); border-radius: 4px; border-left: 3px solid var(--primary-pink);">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <strong class="text-primary">${log.action}</strong>
                                <p class="mb-1 small">${log.details || 'Keine Details'}</p>
                            </div>
                            <small class="text-muted">
                                ${new Date(log.timestamp).toLocaleString('de-DE')}
                            </small>
                        </div>
                    </div>
                `).join('') :
                '<div class="text-center py-3"><i class="fas fa-inbox fa-2x text-muted mb-2"></i><p class="text-muted">Keine Logs gefunden.</p></div>';
            
            const content = `
                <div class="alert alert-info">
                    <h5><i class="fas fa-history"></i> Web User Activity Logs</h5>
                    <p>Zeigt die letzten 50 Aktivitäten dieses Benutzers.</p>
                </div>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${logsList}
                </div>
            `;
            
            showModal('User Activity Logs', content, [
                {
                    text: 'Schließen',
                    class: 'btn-secondary',
                    action: null
                }
            ]);
        })
        .catch(error => {
            console.error('Error loading user logs:', error);
            showToast('Fehler beim Laden der Logs', 'error');
        });
}

function showWebUserSessions(userId) {
    forceModalCleanup();

    const loadingContent = `
        <div class="text-center">
            <i class="fas fa-spinner fa-spin fa-2x text-primary"></i>
            <p class="mt-2">Lade Sessions...</p>
        </div>
    `;
    
    showModal('User Sessions', loadingContent, [
        {
            text: 'Schließen',
            class: 'btn-secondary',
            action: null
        }
    ]);

    fetch(`/api/users/web/${userId}/sessions`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showToast(data.error, 'error');
                forceModalCleanup();
                return;
            }
            
            const sessions = data.sessions || [];
            const sessionsList = sessions.length > 0 ? 
                sessions.map(session => `
                    <div class="session-entry p-3 mb-2" style="background: rgba(255, 255, 255, 0.05); border-radius: 8px; border-left: 4px solid ${session.current ? 'var(--success-color)' : 'var(--text-muted)'};">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <h6 class="mb-1">
                                    <i class="fas fa-${getDeviceIcon(session.device_type)} text-primary"></i>
                                    ${session.device_type}
                                    ${session.current ? '<span class="badge bg-success ms-2">Aktuelle Session</span>' : ''}
                                </h6>
                                <p class="mb-1 small text-muted">
                                    <i class="fas fa-calendar-alt"></i> Erstellt: ${new Date(session.created_at).toLocaleString('de-DE')}
                                </p>
                                <p class="mb-0 small">
                                    <strong>Letzte Aktivität:</strong> ${new Date(session.last_activity).toLocaleString('de-DE')}
                                </p>
                            </div>
                            <div>
                                ${!session.current ? `
                                    <button class="btn btn-outline-danger btn-sm" onclick="terminateSession('${session.session_id}', '${userId}')">
                                        <i class="fas fa-times"></i> Beenden
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `).join('') :
                '<div class="text-center py-3"><i class="fas fa-desktop fa-2x text-muted mb-2"></i><p class="text-muted">Keine aktiven Sessions gefunden.</p></div>';
            
            const content = `
                <div class="alert alert-info">
                    <h5><i class="fas fa-desktop"></i> Aktive Sessions</h5>
                    <p>Übersicht über alle aktiven Anmeldungen dieses Benutzers.</p>
                </div>
                ${sessionsList}
            `;

            showModal('User Sessions', content, [
                {
                    text: 'Alle anderen Sessions beenden',
                    class: 'btn-warning',
                    action: () => terminateAllOtherSessions(userId)
                },
                {
                    text: 'Schließen',
                    class: 'btn-secondary',
                    action: null
                }
            ]);
        })
        .catch(error => {
            console.error('Error loading user sessions:', error);
            showToast('Fehler beim Laden der Sessions', 'error');
            forceModalCleanup();
        });
}

function getDeviceIcon(deviceType) {
    const iconMap = {
        'Desktop': 'desktop',
        'Mobile': 'mobile-alt',
        'Tablet': 'tablet-alt',
        'Unknown': 'question-circle'
    };
    return iconMap[deviceType] || 'question-circle';
}

function terminateSession(sessionId, userId) {
    if (!confirm('Möchtest du diese Session beenden?')) {
        return;
    }
    
    fetch(`/api/users/web/${userId}/sessions/${sessionId}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Session erfolgreich beendet', 'success');
            showWebUserSessions(userId);
        } else {
            showToast(data.error || 'Fehler beim Beenden der Session', 'error');
        }
    })
    .catch(error => {
        console.error('Error terminating session:', error);
        showToast('Fehler beim Beenden der Session', 'error');
    });
}

function terminateAllOtherSessions(userId) {
    if (!confirm('Möchtest du alle anderen Sessions dieses Benutzers beenden? Der Benutzer wird dann nur noch in der aktuellen Session angemeldet sein.')) {
        return;
    }
    
    fetch(`/api/users/web/${userId}/sessions/terminate-others`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(`${data.terminated_count} Sessions beendet`, 'success');
            showWebUserSessions(userId);
        } else {
            showToast(data.error || 'Fehler beim Beenden der Sessions', 'error');
        }
    })
    .catch(error => {
        console.error('Error terminating sessions:', error);
        showToast('Fehler beim Beenden der Sessions', 'error');
    });
}

function openDiscordProfile(userId) {
    const discordUrl = `https://discord.com/users/${userId}`;
    window.open(discordUrl, '_blank');
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('In Zwischenablage kopiert!', 'success');
        }).catch(() => {
            fallbackCopyToClipboard(text);
        });
    } else {
        fallbackCopyToClipboard(text);
    }
}

function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast('In Zwischenablage kopiert!', 'success');
        } else {
            showToast('Kopieren fehlgeschlagen', 'error');
        }
    } catch (err) {
        console.error('Fallback copy failed:', err);
        showToast('Kopieren fehlgeschlagen', 'error');
    }
    
    document.body.removeChild(textArea);
}

function refreshUserData() {
    showToast('Daten werden aktualisiert...', 'info');
    loadAllUserStats();
    setTimeout(() => {
        showToast('Daten aktualisiert!', 'success');
    }, 1000);
}

function exportUsers() {
    const discordRows = document.querySelectorAll('.discord-user-row');
    const webRows = document.querySelectorAll('.web-user-row');
    
    const discordData = Array.from(discordRows).map(row => {
        const username = row.querySelector('.username strong')?.textContent || 'N/A';
        const userId = row.querySelector('code')?.textContent || 'N/A';
        const status = row.querySelector('.badge')?.textContent.trim() || 'N/A';
        const joinDate = row.querySelector('.join-date')?.textContent || 'N/A';
        return `"${username}","${userId}","${status}","${joinDate}","Discord"`;
    });
    
    const webData = Array.from(webRows).map(row => {
        const username = row.querySelector('.username strong')?.textContent || 'N/A';
        const role = row.querySelector('.role-badge')?.textContent.trim() || 'N/A';
        const createdElements = row.querySelectorAll('.login-info div');
        const created = createdElements.length > 0 ? createdElements[0]?.textContent.split('\n')[1]?.trim() || 'N/A' : 'N/A';
        const lastLogin = createdElements.length > 1 ? createdElements[1]?.textContent.split('\n')[1]?.trim() || 'N/A' : 'N/A';
        return `"${username}","N/A","${role}","${created}","Web","${lastLogin}"`;
    });
    
    let csv = 'Benutzername,User ID,Status/Rolle,Erstellt/Beigetreten,Typ,Letzter Login\n';
    csv += discordData.join('\n');
    if (discordData.length > 0 && webData.length > 0) {
        csv += '\n';
    }
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
    
    showToast('Benutzerdaten exportiert!', 'success');
}

function showModal(title, content, buttons = []) {
    let modal = document.getElementById('dynamicModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dynamicModal';
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content bg-dark">
                    <div class="modal-header">
                        <h5 class="modal-title" id="dynamicModalTitle"></h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="dynamicModalBody"></div>
                    <div class="modal-footer" id="dynamicModalFooter"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('dynamicModalTitle').innerHTML = title;
    document.getElementById('dynamicModalBody').innerHTML = content;

    const footer = document.getElementById('dynamicModalFooter');
    footer.innerHTML = '';
    
    buttons.forEach(button => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${button.class}`;
        btn.textContent = button.text;
        
        if (button.action) {
            btn.onclick = () => {
                try {
                    button.action();
                } catch (error) {
                    console.error('Button action error:', error);
                }
                const modalInstance = bootstrap.Modal.getInstance(modal);
                if (modalInstance) {
                    modalInstance.hide();
                }
            };
        } else {
            btn.setAttribute('data-bs-dismiss', 'modal');
        }
        
        footer.appendChild(btn);
    });

    modal.addEventListener('hidden.bs.modal', function () {
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());

        document.body.classList.remove('modal-open');
       
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    });

    const modalInstance = new bootstrap.Modal(modal, {
        backdrop: true,
        keyboard: true
    });
    modalInstance.show();
}

function forceModalCleanup() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        const modalInstance = bootstrap.Modal.getInstance(modal);
        if (modalInstance) {
            modalInstance.hide();
        }
    });

    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());

    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    
    console.log('Modal cleanup forced');
}

function showToast(message, type = 'info') {
    const toastContainer = getOrCreateToastContainer();
    const toastId = 'toast-' + Date.now();
    
    const icons = {
        'success': 'fas fa-check-circle',
        'error': 'fas fa-exclamation-circle',
        'warning': 'fas fa-exclamation-triangle',
        'info': 'fas fa-info-circle'
    };
    
    const colors = {
        'success': 'bg-success',
        'error': 'bg-danger',
        'warning': 'bg-warning',
        'info': 'bg-info'
    };
    
    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center text-white ${colors[type]} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">
                    <i class="${icons[type]}"></i>
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 4000 });
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

function handleKeyboardShortcuts(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        forceModalCleanup();
        return;
    }
    
    if (document.querySelector('.modal.show')) {
        return;
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.getElementById('discordSearch');
        if (searchInput) {
            searchInput.focus();
        }
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showCreateWebUserModal();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportUsers();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        refreshUserData();
    }
}

function handleApiError(error, context = '') {
    console.error(`API Error ${context}:`, error);
    
    if (error.message && error.message.includes('401')) {
        showToast('Sitzung abgelaufen. Bitte melde dich erneut an.', 'error');
        setTimeout(() => window.location.href = '/login', 2000);
    } else if (error.message && error.message.includes('403')) {
        showToast('Keine Berechtigung für diese Aktion.', 'error');
    } else if (error.message && error.message.includes('404')) {
        showToast('Ressource nicht gefunden.', 'error');
    } else if (error.message && error.message.includes('500')) {
        showToast('Serverfehler. Bitte versuche es später erneut.', 'error');
    } else {
        showToast(error.message || 'Ein unbekannter Fehler ist aufgetreten.', 'error');
    }
}

function initializePage() {
    console.log('14th Squad User Management - Initializing...');

    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });
    
    console.log('14th Squad User Management - Ready!');
}

window.addEventListener('beforeunload', function() {
    console.log('14th Squad User Management - Cleanup complete');
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}

function testToasts() {
    showToast('Success message', 'success');
    setTimeout(() => showToast('Error message', 'error'), 1000);
    setTimeout(() => showToast('Info message', 'info'), 2000);
    setTimeout(() => showToast('Warning message', 'warning'), 3000);
}

function simulateApiCall(endpoint, method = 'GET', data = null) {
    console.log(`Simulating API call: ${method} ${endpoint}`, data);
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({ success: true, message: 'Simulated response' });
        }, 1000);
    });
}

window.SquadUserManagement = {
    testToasts,
    simulateApiCall,
    showModal,
    showToast
};