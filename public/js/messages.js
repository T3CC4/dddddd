// View Toggle Functionality
document.addEventListener('DOMContentLoaded', function() {
    const viewRadios = document.querySelectorAll('input[name="msgView"]');
    const messagesContainer = document.getElementById('messagesContainer');
    
    viewRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.id === 'compact') {
                messagesContainer.classList.add('compact');
            } else {
                messagesContainer.classList.remove('compact');
            }
            
            // Speichere Präferenz
            localStorage.setItem('messageView', this.id);
        });
    });
    
    // Lade gespeicherte Ansicht
    const savedView = localStorage.getItem('messageView');
    if (savedView) {
        const savedRadio = document.getElementById(savedView);
        if (savedRadio) {
            savedRadio.checked = true;
            if (savedView === 'compact') {
                messagesContainer.classList.add('compact');
            }
        }
    }
});

// Message Actions
function showMessageDetails(messageId) {
    const content = `
        <div class="row">
            <div class="col-md-6">
                <h6 style="color: var(--discord-header-primary); margin-bottom: 12px;">
                    <i class="fas fa-info-circle"></i> Nachrichten-Information
                </h6>
                <div style="background: var(--discord-bg-secondary); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                    <div style="color: var(--discord-text-muted); font-size: 12px; text-transform: uppercase; margin-bottom: 4px;">Message ID</div>
                    <code style="color: var(--discord-text-normal); background: var(--discord-bg-tertiary); padding: 2px 4px; border-radius: 3px;">${messageId}</code>
                </div>
                <div style="background: var(--discord-bg-secondary); padding: 12px; border-radius: 6px;">
                    <div style="color: var(--discord-text-muted); font-size: 12px; text-transform: uppercase; margin-bottom: 4px;">Typ</div>
                    <div style="color: var(--discord-text-normal);">Reguläre Nachricht</div>
                </div>
            </div>
            <div class="col-md-6">
                <h6 style="color: var(--discord-header-primary); margin-bottom: 12px;">
                    <i class="fas fa-cog"></i> Metadaten
                </h6>
                <div style="background: var(--discord-bg-secondary); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: var(--discord-text-muted);">Bearbeitet:</span>
                        <span style="color: var(--discord-text-normal);">Nein</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--discord-text-muted);">Gelöscht:</span>
                        <span style="color: var(--discord-text-normal);">Nein</span>
                    </div>
                </div>
                <div style="background: var(--discord-bg-secondary); padding: 12px; border-radius: 6px;">
                    <div style="color: var(--discord-text-muted); font-size: 12px; text-transform: uppercase; margin-bottom: 4px;">Aktionen verfügbar</div>
                    <div style="color: var(--discord-text-normal); font-size: 14px;">
                        <i class="fas fa-check" style="color: var(--discord-positive); margin-right: 4px;"></i> Details anzeigen<br>
                        <i class="fas fa-check" style="color: var(--discord-positive); margin-right: 4px;"></i> In Discord öffnen<br>
                        <i class="fas fa-check" style="color: var(--discord-positive); margin-right: 4px;"></i> Nachricht kopieren
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('messageDetailsContent').innerHTML = content;
    new bootstrap.Modal(document.getElementById('messageDetailsModal')).show();
}

function jumpToMessage(messageId, channelId) {
    // Discord Deep Link
    const guildId = '<%= typeof CONFIG !== "undefined" ? CONFIG.GUILD_ID : "1406183789964562432" %>';
    const discordUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
    window.open(discordUrl, '_blank');
    
    // Toast Notification
    showToast('Discord wird geöffnet...', 'info');
}

function copyMessage(content) {
    if (!content || content === '[Nachricht ohne Inhalt]') {
        showToast('Keine Nachricht zum Kopieren vorhanden', 'warning');
        return;
    }
    
    copyToClipboard(content);
}

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
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
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

// Export Messages
function exportMessages() {
    const messages = document.querySelectorAll('.discord-message');
    let csv = 'Zeitstempel,Benutzer,Channel,Nachricht,Status,Message ID\n';
    
    messages.forEach(msg => {
        const messageData = extractMessageData(msg);
        if (messageData) {
            const escapedContent = (messageData.content || '').replace(/"/g, '""');
            csv += `"${messageData.timestamp}","${messageData.author}","${messageData.channel}","${escapedContent}","${messageData.status}","${messageData.messageId}"\n`;
        }
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `14th_squad_messages_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Nachrichten exportiert!', 'success');
}

function extractMessageData(messageElement) {
    const timestampEl = messageElement.querySelector('.message-timestamp-full');
    const authorEl = messageElement.querySelector('.message-author');
    const contentEl = messageElement.querySelector('.message-content-text');
    const channelEl = messageElement.querySelector('.channel-badge');
    
    if (!timestampEl || !authorEl || !contentEl) return null;
    
    const isDeleted = messageElement.classList.contains('message-deleted');
    const isEdited = messageElement.classList.contains('message-edited');
    const messageId = messageElement.getAttribute('data-message-id') || 'unknown';
    
    let status = 'Normal';
    if (isDeleted) status = 'Gelöscht';
    else if (isEdited) status = 'Bearbeitet';
    
    return {
        timestamp: timestampEl.textContent.trim(),
        author: authorEl.textContent.trim(),
        channel: channelEl ? channelEl.textContent.trim().replace('#', '') : 'Unknown',
        content: contentEl.textContent.trim(),
        status: status,
        messageId: messageId
    };
}

// Toast Notifications
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
        'success': 'var(--discord-positive)',
        'error': 'var(--discord-danger)',
        'warning': 'var(--discord-warning)',
        'info': 'var(--discord-brand)'
    };
    
    const toastHtml = `
        <div id="${toastId}" class="discord-toast" style="background: var(--discord-bg-floating); border: 1px solid var(--discord-bg-modifier-active); color: var(--discord-text-normal);">
            <div style="display: flex; align-items: center; padding: 12px 16px;">
                <i class="${icons[type]}" style="color: ${colors[type]}; margin-right: 8px; font-size: 16px;"></i>
                <span style="flex: 1;">${message}</span>
                <button onclick="removeToast('${toastId}')" style="background: none; border: none; color: var(--discord-interactive-normal); cursor: pointer; margin-left: 8px; padding: 4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    
    // Auto-remove nach 4 Sekunden
    setTimeout(() => {
        removeToast(toastId);
    }, 4000);
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

// Real-time search
let searchTimeout;
document.getElementById('search').addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const query = this.value;
    
    if (query.length >= 2) {
        searchTimeout = setTimeout(() => {
            // Highlight existing messages
            highlightSearchTerms(query);
        }, 300);
    } else {
        // Remove highlights
        removeAllHighlights();
    }
});

function highlightSearchTerms(searchTerm) {
    const messages = document.querySelectorAll('.message-content-text');
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    
    messages.forEach(msg => {
        const originalText = msg.textContent;
        if (originalText.toLowerCase().includes(searchTerm.toLowerCase())) {
            msg.innerHTML = originalText.replace(regex, '<mark class="discord-highlight">$1</mark>');
        }
    });
}

function removeAllHighlights() {
    const highlights = document.querySelectorAll('.discord-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize();
    });
}

// Scroll to bottom functionality
function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

// Auto-scroll on new messages (falls implementiert)
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // Optional: Auto-scroll to new messages
            // scrollToBottom();
        }
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + F für Suche
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('search').focus();
    }
    
    // Escape um Suche zu leeren
    if (e.key === 'Escape') {
        const searchInput = document.getElementById('search');
        if (searchInput.value) {
            searchInput.value = '';
            removeAllHighlights();
            // Optional: Reload page to clear search
            // window.location.href = '/messages';
        }
    }
    
    // Ctrl/Cmd + E für Export
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportMessages();
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Lade Message Count
    updateMessageCount();
    
    // Auto-refresh alle 30 Sekunden (optional)
    // setInterval(() => {
    //     if (!document.hidden) {
    //         location.reload();
    //     }
    // }, 30000);
});

function updateMessageCount() {
    const messages = document.querySelectorAll('.discord-message');
    const countElement = document.getElementById('visibleMessages');
    if (countElement) {
        countElement.textContent = messages.length;
    }
}

// Lazy loading für Avatar-Bilder
function setupLazyLoading() {
    const avatars = document.querySelectorAll('.user-avatar');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src || img.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });
    
    avatars.forEach(img => {
        imageObserver.observe(img);
    });
}

// CSS für Toast Notifications
const toastStyles = `
.discord-toast {
    border-radius: 8px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
    transition: all 0.3s ease;
    transform: translateX(0);
    opacity: 1;
    animation: slideInRight 0.3s ease;
}

@keyframes slideInRight {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}
`;

// Füge Toast Styles zum Head hinzu
const styleSheet = document.createElement('style');
styleSheet.textContent = toastStyles;
document.head.appendChild(styleSheet);