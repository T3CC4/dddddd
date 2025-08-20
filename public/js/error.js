setTimeout(() => {
    if (document.referrer && document.referrer.includes('/dashboard')) {
        window.location.href = '/dashboard';
    }
}, 30000);
        
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        history.back();
    } else if (e.key === 'Enter') {
        window.location.href = '/dashboard';
    }
});