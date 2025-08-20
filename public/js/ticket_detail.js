// Ticket Detail JavaScript - Vollständig implementiert ohne Template-Code
let currentTicketId = null;
let ticketData = null;

// Initialisierung beim Laden der Seite
document.addEventListener('DOMContentLoaded', function() {
    // Extrahiere Ticket ID aus der URL
    const pathParts = window.location.pathname.split('/');
    currentTicketId = pathParts[pathParts.length - 1];
    
    console.log('Ticket Detail geladen für:', currentTicketId);
    
    // Lade Ticket-Daten
    loadTicketData();
    
    // Scroll zum Ende der Nachrichten
    scrollToBottomOfMessages();
    
    // Initialize tooltips
    initializeTooltips();
    
    // Starte Auto-refresh für offene Tickets
    startAutoRefresh();
});

// Lade Ticket-Daten über API
async function loadTicketData() {
    try {
        const response = await fetch(`/api/tickets/${currentTicketId}/details`);
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                ticketData = data.ticket;
                console.log('Ticket-Daten geladen:', ticketData);
                return;
            }
        }
        console.log('API nicht verfügbar, verwende Fallback');
    } catch (error) {
        console.log('Netzwerkfehler beim Laden der Ticket-Daten:', error);
    }
    
    // Fallback: Extrahiere Daten aus der Seite
    ticketData = extractTicketDataFromPage();
}

function closeTicket() {
    if (!currentTicketId) {
        showToast('Ticket ID nicht gefunden', 'error');
        return;
    }
    
    if (confirm('Bist du sicher, dass du dieses Ticket schließen möchtest?\n\nDas Transcript wird gespeichert und der Discord-Channel wird gelöscht.')) {
        const closeBtn = document.querySelector('button[onclick="closeTicket()"]');
        if (closeBtn) {
            closeBtn.disabled = true;
            closeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Schließe...';
        }
        
        fetch(`/api/tickets/${currentTicketId}/close`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('Ticket erfolgreich geschlossen!', 'success');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                showToast('Fehler beim Schließen: ' + (data.error || 'Unbekannter Fehler'), 'error');
                if (closeBtn) {
                    closeBtn.disabled = false;
                    closeBtn.innerHTML = '<i class="fas fa-lock"></i> Schließen';
                }
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToast('Netzwerkfehler beim Schließen des Tickets', 'error');
            if (closeBtn) {
                closeBtn.disabled = false;
                closeBtn.innerHTML = '<i class="fas fa-lock"></i> Schließen';
            }
        });
    }
}

function viewTranscriptModal() {
    const transcriptContent = document.getElementById('transcriptContent');
    
    if (!transcriptContent) {
        showToast('Transcript Modal nicht gefunden', 'error');
        return;
    }
    
    const transcriptData = getTranscriptFromPage();
    
    if (!transcriptData || transcriptData.length === 0) {
        transcriptContent.innerHTML = `
            <div class="text-center py-4">
                <i class="fas fa-exclamation-triangle fa-2x text-warning mb-3"></i>
                <p class="text-muted">Kein Transcript verfügbar oder Nachrichten noch nicht geladen.</p>
                <p class="text-info">
                    <small>Nachrichten: ${transcriptData ? transcriptData.length : 0} gefunden</small>
                </p>
            </div>
        `;
    } else {
        let content = '<div class="ticket-messages" style="max-height: 400px; overflow-y: auto;">';
        
        transcriptData.forEach((msg, index) => {
            const timestamp = formatTimestamp(msg.timestamp);
            const isSystem = msg.user_id === 'SYSTEM' || msg.username === 'System';
            
            content += `
            <div class="discord-message ${isSystem ? 'system-message' : ''} ${msg.deleted ? 'deleted-message' : ''}" style="margin-bottom: 0.5rem; padding: 0.5rem; border-radius: 8px; background: rgba(255,255,255,0.02);">
                <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                    <div class="message-avatar" style="flex-shrink: 0;">
                        <div class="avatar ${isSystem ? 'system-avatar' : 'user-avatar'}" style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${isSystem ? 'var(--warning-color)' : 'var(--primary-pink)'}; color: white; font-weight: bold; font-size: 0.8rem;">
                            ${isSystem ? '<i class="fas fa-cog"></i>' : getAvatarInitial(msg.username)}
                        </div>
                    </div>
                    <div class="message-content-wrapper" style="flex: 1; min-width: 0;">
                        <div class="message-header" style="display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem;">
                            <span class="message-author ${isSystem ? 'system-author' : ''}" style="font-weight: 600; color: ${isSystem ? 'var(--warning-color)' : 'var(--text-primary)'};">${escapeHtml(msg.username)}</span>
                            <span class="message-timestamp" style="font-size: 0.75rem; color: var(--text-muted);">${timestamp}</span>
                            ${msg.edited ? '<span class="badge bg-warning" style="font-size: 0.6rem;">bearbeitet</span>' : ''}
                            ${msg.deleted ? '<span class="badge bg-danger" style="font-size: 0.6rem;">gelöscht</span>' : ''}
                        </div>
                        <div class="message-text" style="word-wrap: break-word; line-height: 1.4; color: var(--text-primary);">${escapeHtml(msg.content || '[Nachricht ohne Inhalt]')}</div>
                        ${msg.attachments ? `<div class="message-attachments" style="margin-top: 0.25rem; font-size: 0.8rem; color: var(--text-muted);"><i class="fas fa-paperclip"></i> Anhänge: ${escapeHtml(msg.attachments)}</div>` : ''}
                    </div>
                </div>
            </div>`;
        });
        
        content += '</div>';
        transcriptContent.innerHTML = content;
    }
    
    const modal = new bootstrap.Modal(document.getElementById('transcriptModal'));
    modal.show();
}

function downloadTranscript() {
    if (!currentTicketId) {
        showToast('Ticket ID nicht gefunden', 'error');
        return;
    }
    
    // Versuche zuerst den API-Endpunkt
    const downloadUrl = `/api/tickets/${currentTicketId}/transcript`;
    
    fetch(downloadUrl)
        .then(response => {
            if (response.ok) {
                return response.blob();
            } else {
                throw new Error('API nicht verfügbar');
            }
        })
        .then(blob => {
            // Download über API erfolgreich
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ticket_${currentTicketId}_transcript.txt`;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            window.URL.revokeObjectURL(url);
            showToast('Transcript-Download gestartet', 'success');
        })
        .catch(error => {
            // Fallback: Generiere Transcript aus Seite
            console.log('API Download fehlgeschlagen, verwende Fallback:', error);
            generateTranscriptFromPage();
        });
}

function generateTranscriptFromPage() {
    const messages = getTranscriptFromPage();
    const ticketInfo = getTicketInfoFromPage();
    
    let content = `14th Squad - Ticket Transcript\n`;
    content += `${'='.repeat(60)}\n`;
    content += `Ticket ID: ${currentTicketId}\n`;
    content += `Status: ${ticketInfo.status || 'Unbekannt'}\n`;
    content += `Benutzer: ${ticketInfo.username || 'Unbekannt'}\n`;
    content += `User ID: ${ticketInfo.user_id || 'Unbekannt'}\n`;
    content += `Channel: ${ticketInfo.channel_id || 'Unbekannt'}\n`;
    content += `Erstellt: ${ticketInfo.created_at || 'Unbekannt'}\n`;
    if (ticketInfo.closed_at) {
        content += `Geschlossen: ${ticketInfo.closed_at}\n`;
    }
    content += `Nachrichten: ${messages.length}\n`;
    content += `${'='.repeat(60)}\n\n`;
    
    messages.forEach((msg, index) => {
        const timestamp = formatTimestamp(msg.timestamp);
        content += `[${index + 1}] [${timestamp}] ${msg.username}:\n`;
        content += `${msg.content || '[Keine Nachricht]'}\n`;
        
        if (msg.attachments) {
            content += `    📎 Anhänge: ${msg.attachments}\n`;
        }
        
        if (msg.edited) {
            content += `    ✏️ Nachricht wurde bearbeitet\n`;
        }
        
        if (msg.deleted) {
            content += `    🗑️ Nachricht wurde gelöscht\n`;
        }
        
        content += '\n';
    });
    
    content += `\n${'='.repeat(60)}\n`;
    content += `Transcript erstellt: ${new Date().toLocaleString('de-DE')}\n`;
    content += `14th Squad Management System v1.1\n`;
    
    // Download als Datei
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ticket_${currentTicketId}_transcript_${Date.now()}.txt`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    showToast('Transcript erfolgreich generiert und heruntergeladen!', 'success');
}

function exportTicketData() {
    if (!currentTicketId) {
        showToast('Ticket ID nicht gefunden', 'error');
        return;
    }
    
    // Sammle alle verfügbaren Ticket-Daten
    const ticketInfo = getTicketInfoFromPage();
    const messages = getTranscriptFromPage();
    
    const exportData = {
        ticket_info: {
            ticket_id: currentTicketId,
            ...ticketInfo
        },
        statistics: {
            total_messages: messages.length,
            messages_by_user: getMessageStatistics(messages),
            duration_minutes: ticketInfo.closed_at && ticketInfo.created_at ? 
                calculateDuration(ticketInfo.created_at, ticketInfo.closed_at) : null,
            export_timestamp: new Date().toISOString()
        },
        messages: messages,
        export_info: {
            exported_by: getCurrentUsername(),
            exported_at: new Date().toISOString(),
            system_version: '14th Squad Management v1.1'
        }
    };
    
    // Erstelle Download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
        type: 'application/json;charset=utf-8;' 
    });
    
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ticket_${currentTicketId}_data_${Date.now()}.json`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    showToast('Ticket-Daten erfolgreich exportiert!', 'success');
}

// Hilfsfunktionen

function extractTicketDataFromPage() {
    const data = {};
    
    try {
        // Ticket ID aus URL
        data.ticket_id = currentTicketId;
        
        // Status aus Badge
        const statusBadge = document.querySelector('.badge');
        if (statusBadge) {
            data.status = statusBadge.textContent.includes('Offen') ? 'open' : 'closed';
        }
        
        // Weitere Daten aus der Info-Tabelle
        const infoTable = document.querySelector('.card-body table');
        if (infoTable) {
            const rows = infoTable.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length === 2) {
                    const key = cells[0].textContent.replace(':', '').trim();
                    const value = cells[1].textContent.trim();
                    
                    switch(key) {
                        case 'Benutzer':
                            // Extrahiere User ID aus dem Text
                            const idMatch = value.match(/ID:\s*(\S+)/);
                            if (idMatch) {
                                data.user_id = idMatch[1];
                            }
                            // Extrahiere Username (vor "ID:")
                            const usernameMatch = value.split('ID:')[0].trim();
                            if (usernameMatch) {
                                data.username = usernameMatch.replace(/^\S+\s+/, ''); // Entferne Icon
                            }
                            break;
                        case 'Channel ID':
                            data.channel_id = value;
                            break;
                        case 'Erstellt':
                            data.created_at = value;
                            break;
                        case 'Geschlossen':
                            if (value !== '-') {
                                data.closed_at = value;
                            }
                            break;
                    }
                }
            });
        }
        
        console.log('Extrahierte Ticket-Daten:', data);
        return data;
    } catch (error) {
        console.error('Fehler beim Extrahieren der Ticket-Daten:', error);
        return { ticket_id: currentTicketId };
    }
}

function getTranscriptFromPage() {
    const messages = [];
    const messageElements = document.querySelectorAll('.discord-message');
    
    messageElements.forEach(msgEl => {
        const author = msgEl.querySelector('.message-author')?.textContent?.trim() || 'Unbekannt';
        const timestamp = msgEl.querySelector('.message-timestamp')?.textContent?.trim() || new Date().toISOString();
        const content = msgEl.querySelector('.message-text')?.textContent?.trim() || '';
        const attachmentsEl = msgEl.querySelector('.message-attachments small');
        const attachments = attachmentsEl ? attachmentsEl.textContent.replace('Anhänge: ', '') : '';
        
        const isEdited = msgEl.querySelector('.badge.bg-warning') !== null;
        const isDeleted = msgEl.querySelector('.badge.bg-danger') !== null;
        const isSystem = msgEl.classList.contains('system-message');
        
        messages.push({
            username: author,
            content: content,
            timestamp: parseTimestamp(timestamp),
            attachments: attachments,
            edited: isEdited,
            deleted: isDeleted,
            user_id: isSystem ? 'SYSTEM' : 'USER'
        });
    });
    
    return messages;
}

function getTicketInfoFromPage() {
    const info = {};
    
    // Extrahiere Informationen aus der Tabelle
    const infoTable = document.querySelector('.card-body table');
    if (infoTable) {
        const rows = infoTable.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length === 2) {
                const key = cells[0].textContent.replace(':', '').trim();
                const value = cells[1].textContent.trim();
                
                switch(key) {
                    case 'Status':
                        info.status = value.includes('Offen') ? 'open' : 'closed';
                        break;
                    case 'Benutzer':
                        info.user_info = value;
                        const idMatch = value.match(/ID:\s*(\S+)/);
                        if (idMatch) {
                            info.user_id = idMatch[1];
                        }
                        const usernameMatch = value.split('ID:')[0].trim();
                        if (usernameMatch) {
                            info.username = usernameMatch.replace(/^\S+\s+/, '');
                        }
                        break;
                    case 'Channel ID':
                        info.channel_id = value;
                        break;
                    case 'Erstellt':
                        info.created_at = value;
                        break;
                    case 'Geschlossen':
                        if (value !== '-') info.closed_at = value;
                        break;
                }
            }
        });
    }
    
    return info;
}

function getMessageStatistics(messages) {
    const stats = {};
    messages.forEach(msg => {
        if (stats[msg.username]) {
            stats[msg.username]++;
        } else {
            stats[msg.username] = 1;
        }
    });
    return stats;
}

function parseTimestamp(timestampStr) {
    try {
        // Deutscher Format: "31.12.2023, 23:59:59"
        if (timestampStr.includes(',')) {
            const [datePart, timePart] = timestampStr.split(', ');
            const [day, month, year] = datePart.split('.');
            return new Date(`${year}-${month}-${day}T${timePart}`).toISOString();
        }
        
        // Fallback: versuche direktes Parsing
        return new Date(timestampStr).toISOString();
    } catch (error) {
        console.warn('Konnte Timestamp nicht parsen:', timestampStr);
        return new Date().toISOString();
    }
}

function formatTimestamp(isoString) {
    try {
        return new Date(isoString).toLocaleString('de-DE');
    } catch (error) {
        return isoString;
    }
}

function calculateDuration(startStr, endStr) {
    try {
        const start = new Date(startStr);
        const end = new Date(endStr);
        return Math.round((end - start) / (1000 * 60)); // Minuten
    } catch (error) {
        return null;
    }
}

function getAvatarInitial(username) {
    return (username || 'U').charAt(0).toUpperCase();
}

function getCurrentUsername() {
    // Versuche den aktuellen Benutzernamen aus der Navigation zu extrahieren
    const userElement = document.querySelector('.navbar .dropdown-toggle');
    if (userElement) {
        const text = userElement.textContent;
        // Extrahiere Namen vor dem Badge
        const parts = text.trim().split(/\s+/);
        return parts[0] || 'Unbekannt';
    }
    return 'Unbekannt';
}

function scrollToBottomOfMessages() {
    const messagesContainer = document.querySelector('.ticket-messages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function initializeTooltips() {
    // Initialize Bootstrap tooltips if available
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[title]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Auto-refresh für offene Tickets (alle 30 Sekunden)
function startAutoRefresh() {
    // Prüfe erst nach dem Laden der Ticket-Daten
    setTimeout(() => {
        const isOpen = ticketData?.status === 'open' || 
                      document.querySelector('.badge')?.textContent?.includes('Offen');
        
        if (isOpen && !document.hidden) {
            console.log('Auto-refresh für offenes Ticket aktiviert');
            setInterval(() => {
                if (!document.hidden) {
                    // Nur refresh wenn Tab aktiv ist und Ticket noch offen
                    const stillOpen = document.querySelector('.badge')?.textContent?.includes('Offen');
                    if (stillOpen) {
                        console.log('Auto-refresh: Lade Seite neu...');
                        location.reload();
                    }
                }
            }, 30000); // 30 Sekunden
        }
    }, 2000);
}

// Toast Notification System
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
        <div id="${toastId}" class="toast-notification" style="background: var(--secondary-bg); border-left: 4px solid ${colors[type]}; color: var(--text-primary); border-radius: 8px; box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24); transition: all 0.3s ease; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; padding: 12px 16px;">
                <i class="${icons[type]}" style="color: ${colors[type]}; margin-right: 8px;"></i>
                <span style="flex: 1;">${message}</span>
                <button onclick="removeToast('${toastId}')" style="background: none; border: none; color: var(--text-muted); margin-left: 8px; cursor: pointer; padding: 4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    
    setTimeout(() => removeToast(toastId), 5000);
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
            max-width: 400px;
        `;
        document.body.appendChild(container);
    }
    return container;
}

function scrollToTop() {
    const container = document.getElementById('ticketMessages');
    if (container) {
        container.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function scrollToBottom() {
    const container = document.getElementById('ticketMessages');
    if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
}

// Message-Funktionen
function copyMessageContent(content) {
    if (!content || content === '[Nachricht ohne Inhalt]') {
        showToast('Keine Nachricht zum Kopieren vorhanden', 'warning');
        return;
    }
    copyToClipboard(content);
}

function copyAllMessages() {
    const messages = document.querySelectorAll('.message-text');
    let allContent = '';
    
    messages.forEach((msg, index) => {
        const author = msg.closest('.discord-message').querySelector('.message-author').textContent;
        const timestamp = msg.closest('.discord-message').querySelector('.message-timestamp').textContent;
        const content = msg.textContent.trim();
        
        if (content && content !== '[Nachricht ohne Inhalt]') {
            allContent += `[${timestamp}] ${author}: ${content}\n`;
        }
    });
    
    if (allContent) {
        copyToClipboard(allContent);
        showToast(`${messages.length} Nachrichten kopiert!`, 'success');
    } else {
        showToast('Keine Nachrichten zum Kopieren gefunden', 'warning');
    }
}

function openDiscordProfile(userId) {
    const discordUrl = `https://discord.com/users/${userId}`;
    window.open(discordUrl, '_blank');
}

function openDiscordChannel(channelId) {
    const guildId = '<%= typeof CONFIG !== "undefined" ? CONFIG.GUILD_ID : "1406183789964562432" %>';
    const discordUrl = `https://discord.com/channels/${guildId}/${channelId}`;
    window.open(discordUrl, '_blank');
}

// Copy-to-clipboard Funktion
function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('In Zwischenablage kopiert!', 'success');
        }).catch(() => {
            fallbackCopyTextToClipboard(text);
        });
    } else {
        fallbackCopyTextToClipboard(text);
    }
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
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
        showToast('Kopieren fehlgeschlagen', 'error');
    }
    
    document.body.removeChild(textArea);
}

// Message Actions on Hover
document.addEventListener('DOMContentLoaded', function() {
    const messages = document.querySelectorAll('.discord-message');
    messages.forEach(message => {
        const actions = message.querySelector('.message-actions');
        if (actions) {
            message.addEventListener('mouseenter', () => {
                actions.style.opacity = '1';
            });
            message.addEventListener('mouseleave', () => {
                actions.style.opacity = '0';
            });
        }
    });
    
    // Auto-scroll to bottom on load
    setTimeout(scrollToBottom, 500);
});

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
    // ESC zum Schließen von Modals
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) {
                modalInstance.hide();
            }
        });
    }
    
    // Ctrl+D für Download Transcript
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        downloadTranscript();
    }
    
    // Ctrl+E für Export
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportTicketData();
    }
    
    // Ctrl+T für Transcript Modal
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        viewTranscriptModal();
    }
});