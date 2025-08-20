let ticketToClose = null;

// Filter Funktionen
function filterTickets() {
    const statusFilter = document.getElementById('statusFilter').value;
    const searchTerm = document.getElementById('ticketSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.ticket-row');
    let visibleCount = 0;

    rows.forEach(row => {
        const status = row.getAttribute('data-status');
        const searchData = row.getAttribute('data-search').toLowerCase();
        
        const statusMatch = !statusFilter || status === statusFilter;
        const searchMatch = !searchTerm || searchData.includes(searchTerm);
        
        if (statusMatch && searchMatch) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    document.getElementById('ticketCount').textContent = visibleCount;
}

// Ticket schließen
function closeTicket(ticketId) {
    ticketToClose = ticketId;
    document.getElementById('closeTicketId').textContent = ticketId;
    new bootstrap.Modal(document.getElementById('closeTicketModal')).show();
}

function confirmCloseTicket() {
    if (!ticketToClose) return;
    
    fetch(`/api/tickets/${ticketToClose}/close`, {
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
            alert('Fehler beim Schließen des Tickets: ' + data.error);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Fehler beim Schließen des Tickets');
    });
    
    bootstrap.Modal.getInstance(document.getElementById('closeTicketModal')).hide();
}

// Transcript downloaden
function downloadTranscript(ticketId) {
    // Hier würde der Download implementiert werden
    alert('Transcript Download für ' + ticketId + ' wird implementiert...');
}

// Auto-refresh alle 30 Sekunden
setTimeout(() => {
    location.reload();
}, 30000);