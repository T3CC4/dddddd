function updateTime() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleString('de-DE');
}

updateTime();
setInterval(updateTime, 1000);

function refreshActivities() {
    const refreshIcon = document.getElementById('refresh-icon');
    const activitiesContainer = document.getElementById('recent-activities');
    
    refreshIcon.classList.add('fa-spin');
    
    fetch('/api/dashboard/activities?limit=10')
        .then(response => response.json())
        .then(data => {
            if (data.activities) {
                updateActivitiesDisplay(data.activities);
                showToast('Aktivitäten aktualisiert!', 'success');
            }
        })
        .catch(error => {
            console.error('Error refreshing activities:', error);
            showToast('Fehler beim Aktualisieren der Aktivitäten', 'error');
        })
        .finally(() => {
            refreshIcon.classList.remove('fa-spin');
        });
}

function updateActivitiesDisplay(activities) {
    const container = document.getElementById('recent-activities');
    
    if (activities.length === 0) {
        container.innerHTML = `
            <div class="no-activities">
                <div class="text-center py-4">
                    <i class="fas fa-history fa-3x text-muted mb-3"></i>
                    <p class="text-muted">Noch keine Aktivitäten vorhanden.</p>
                    <button class="btn btn-squad btn-sm" onclick="refreshActivities()">
                        <i class="fas fa-sync-alt"></i> Aktualisieren
                    </button>
                </div>
            </div>
        `;
        return;
    }
    
    const activitiesHtml = activities.map(activity => `
        <div class="activity-item ${activity.type}" data-activity-type="${activity.type}">
            <div class="activity-icon">
                <i class="${activity.icon} text-${activity.color}"></i>
            </div>
            <div class="activity-content">
                <div class="activity-text">
                    ${activity.text}
                </div>
                <div class="activity-meta">
                    <span class="activity-time">
                        <i class="fas fa-clock"></i> ${activity.time}
                    </span>
                </div>
            </div>
            <div class="activity-actions">
                ${getActivityActions(activity)}
            </div>
        </div>
    `).join('');
    
    container.innerHTML = activitiesHtml;
}

function getActivityActions(activity) {
    switch(activity.type) {
        case 'message':
            return `<button class="btn btn-sm btn-outline-info" onclick="viewMessage('${activity.target}')" title="Nachricht anzeigen"><i class="fas fa-eye"></i></button>`;
        case 'ticket_created':
        case 'ticket_closed':
            return `<button class="btn btn-sm btn-outline-warning" onclick="viewTicket('${activity.target}')" title="Ticket anzeigen"><i class="fas fa-ticket-alt"></i></button>`;
        case 'user_verified':
        case 'user_joined':
            return `<button class="btn btn-sm btn-outline-success" onclick="viewUser('${activity.actor}')" title="Benutzer anzeigen"><i class="fas fa-user"></i></button>`;
        case 'web_activity':
            return `<button class="btn btn-sm btn-outline-secondary" onclick="viewWebLogs()" title="Web Logs anzeigen"><i class="fas fa-globe"></i></button>`;
        default:
            return '';
    }
}

function viewMessage(channelName) {
    window.location.href = `/messages?channel=${encodeURIComponent(channelName)}`;
}

function viewTicket(ticketId) {
    window.location.href = `/tickets/${ticketId}`;
}

function viewUser(username) {
    window.location.href = `/users?search=${encodeURIComponent(username)}`;
}

function viewWebLogs() {
    window.location.href = '/logs';
}

setInterval(refreshActivities, 30000);

function showToast(message, type = 'info') {
    const toastContainer = getOrCreateToastContainer();
    const toastId = 'toast-' + Date.now();
    
    const colors = {
        'success': '#28a745',
        'error': '#dc3545',
        'info': '#17a2b8',
        'warning': '#ffc107'
    };
    
    const icons = {
        'success': 'fas fa-check-circle',
        'error': 'fas fa-exclamation-circle',
        'info': 'fas fa-info-circle',
        'warning': 'fas fa-exclamation-triangle'
    };
    
    const toastHtml = `
        <div id="${toastId}" class="toast-notification" style="background: var(--secondary-bg); border-left: 4px solid ${colors[type]}; color: var(--text-primary);">
            <div style="display: flex; align-items: center; padding: 12px 16px;">
                <i class="${icons[type]}" style="color: ${colors[type]}; margin-right: 8px;"></i>
                <span>${message}</span>
                <button onclick="removeToast('${toastId}')" style="background: none; border: none; color: var(--text-muted); margin-left: auto; cursor: pointer;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    
    setTimeout(() => removeToast(toastId), 4000);
}

function removeToast(toastId) {
    const toast = document.getElementById(toastId);
    if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
}

function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-width: 400px;
        `;
        document.body.appendChild(container);
    }
    return container;
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard loaded - Activities ready for live updates');
    
    if (sessionStorage.getItem('justLoggedIn')) {
        setTimeout(() => {
            showToast('Willkommen zurück! Dashboard geladen.', 'success');
            sessionStorage.removeItem('justLoggedIn');
        }, 500);
    }
});

document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log('Dashboard Tab ist versteckt - Auto-refresh pausiert');
    } else {
        console.log('Dashboard Tab ist aktiv - Auto-refresh aktiv');
        refreshActivities();
    }
});