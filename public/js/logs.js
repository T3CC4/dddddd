// Filter Funktionen
function filterLogs() {
    const actionFilter = document.getElementById('actionFilter').value;
    const userFilter = document.getElementById('userFilter').value;
    const searchTerm = document.getElementById('logSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.log-row');
    let visibleCount = 0;

    rows.forEach(row => {
        const action = row.getAttribute('data-action');
        const user = row.getAttribute('data-user');
        const searchData = row.getAttribute('data-search');
        
        const actionMatch = !actionFilter || action === actionFilter;
        const userMatch = !userFilter || user === userFilter;
        const searchMatch = !searchTerm || searchData.includes(searchTerm);
        
        if (actionMatch && userMatch && searchMatch) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    document.getElementById('logCount').textContent = visibleCount;
    
    // Update pagination info
    const totalVisible = visibleCount;
    const pagination = document.querySelector('.pagination');
    if (pagination && totalVisible === 0) {
        pagination.style.display = 'none';
    } else if (pagination) {
        pagination.style.display = 'flex';
    }
}

// Export Logs
function exportLogs() {
    const rows = document.querySelectorAll('.log-row');
    let csv = 'Zeitstempel,Benutzer,Aktion,Details\n';
    
    rows.forEach(row => {
        if (row.style.display !== 'none') {
            const cells = row.querySelectorAll('td');
            const timestamp = cells[0].textContent.trim().replace(/\n/g, ' ');
            const user = cells[1].textContent.trim().replace(/\n/g, ' ');
            const action = cells[2].textContent.trim();
            const details = cells[3].textContent.trim().replace(/"/g, '""');
            
            csv += `"${timestamp}","${user}","${action}","${details}"\n`;
        }
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `14th_squad_web_logs_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Real-time Filter
let filterTimeout;
document.getElementById('logSearch').addEventListener('input', function() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(filterLogs, 300);
});

// Auto-refresh alle 60 Sekunden
setTimeout(() => {
    if (!document.hidden) {
        location.reload();
    }
}, 60000);

// Page Visibility API - pausiere refresh wenn Tab nicht aktiv
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log('Tab ist versteckt - Auto-refresh pausiert');
    } else {
        console.log('Tab ist aktiv - Auto-refresh aktiv');
    }
});

// Initialize filters
document.addEventListener('DOMContentLoaded', function() {
    // Load filter states from localStorage
    const savedActionFilter = localStorage.getItem('logs_action_filter');
    const savedUserFilter = localStorage.getItem('logs_user_filter');
    const savedSearchTerm = localStorage.getItem('logs_search_term');
    
    if (savedActionFilter) {
        document.getElementById('actionFilter').value = savedActionFilter;
    }
    if (savedUserFilter) {
        document.getElementById('userFilter').value = savedUserFilter;
    }
    if (savedSearchTerm) {
        document.getElementById('logSearch').value = savedSearchTerm;
    }
    
    // Apply filters if any were saved
    if (savedActionFilter || savedUserFilter || savedSearchTerm) {
        filterLogs();
    }
    
    // Save filter states on change
    document.getElementById('actionFilter').addEventListener('change', function() {
        localStorage.setItem('logs_action_filter', this.value);
    });
    
    document.getElementById('userFilter').addEventListener('change', function() {
        localStorage.setItem('logs_user_filter', this.value);
    });
    
    document.getElementById('logSearch').addEventListener('input', function() {
        localStorage.setItem('logs_search_term', this.value);
    });
});

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + F für Suche
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('logSearch').focus();
    }
    
    // Escape um Filter zu löschen
    if (e.key === 'Escape') {
        document.getElementById('actionFilter').value = '';
        document.getElementById('userFilter').value = '';
        document.getElementById('logSearch').value = '';
        localStorage.removeItem('logs_action_filter');
        localStorage.removeItem('logs_user_filter');
        localStorage.removeItem('logs_search_term');
        filterLogs();
    }
    
    // Ctrl/Cmd + E für Export
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportLogs();
    }
});