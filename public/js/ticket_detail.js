function closeTicket() {
    if (confirm('Bist du sicher, dass du dieses Ticket schließen möchtest?')) {
        fetch(`/api/tickets/<%= ticket.ticket_id %>/close`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                location.reload();
            } else {
                alert('Fehler beim Schließen: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Fehler beim Schließen des Tickets');
        });
    }
}

function viewTranscriptModal() {
    <% if (ticket.transcript) { %>
    const transcript = JSON.parse('<%= ticket.transcript.replace(/'/g, "\\'") %>');
    let content = '<div class="ticket-messages">';
    
    transcript.forEach(msg => {
        content += `
        <div class="discord-message ${msg.user_id === 'SYSTEM' ? 'system-message' : ''}">
            <div class="message-avatar">
                <div class="avatar ${msg.user_id === 'SYSTEM' ? 'system-avatar' : 'user-avatar'}">
                    ${msg.user_id === 'SYSTEM' ? '<i class="fas fa-cog"></i>' : msg.username.charAt(0).toUpperCase()}
                </div>
            </div>
            <div class="message-content-wrapper">
                <div class="message-header">
                    <span class="message-author">${msg.username}</span>
                    <span class="message-timestamp">${new Date(msg.timestamp).toLocaleString('de-DE')}</span>
                </div>
                <div class="message-text">${msg.content || '[Nachricht ohne Inhalt]'}</div>
            </div>
        </div>`;
    });
    
    content += '</div>';
    document.getElementById('transcriptContent').innerHTML = content;
    <% } %>
    
    new bootstrap.Modal(document.getElementById('transcriptModal')).show();
}

function downloadTranscript() {
    <% if (ticket.transcript) { %>
    const transcript = JSON.parse('<%= ticket.transcript.replace(/'/g, "\\'") %>');
    let content = `Ticket Transcript: <%= ticket.ticket_id %>\n`;
    content += `Erstellt: <%= new Date(ticket.created_at).toLocaleString('de-DE') %>\n`;
    content += `Status: <%= ticket.status %>\n`;
    content += `${'='.repeat(50)}\n\n`;
    
    transcript.forEach(msg => {
        content += `[${new Date(msg.timestamp).toLocaleString('de-DE')}] ${msg.username}: ${msg.content || '[Nachricht ohne Inhalt]'}\n`;
    });
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ticket_<%= ticket.ticket_id %>_transcript.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    <% } %>
}

function exportTicketData() {
    const ticketData = {
        ticket_id: '<%= ticket.ticket_id %>',
        user_id: '<%= ticket.user_id %>',
        status: '<%= ticket.status %>',
        created_at: '<%= ticket.created_at %>',
        closed_at: '<%= ticket.closed_at || "" %>',
        messages: <%= JSON.stringify(messages) %>
    };
    
    const blob = new Blob([JSON.stringify(ticketData, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ticket_<%= ticket.ticket_id %>_data.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Scroll to bottom of messages
document.addEventListener('DOMContentLoaded', function() {
    const messagesContainer = document.querySelector('.ticket-messages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});