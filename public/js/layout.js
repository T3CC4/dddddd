$(document).ready(function() {
    $('.navbar-toggler').click(function() {
        $('#sidebar').toggleClass('show');
    });

    $(document).click(function(event) {
        if (!$(event.target).closest('#sidebar, .navbar-toggler').length) {
            $('#sidebar').removeClass('show');
        }
    });
});

if (window.location.pathname === '/dashboard') {
    setTimeout(() => {
        location.reload();
    }, 30000);
}

function highlightSearch(text, search) {
    if (!search) return text;
    const regex = new RegExp(`(${search})`, 'gi');
    return text.replace(regex, '<span class="search-highlight">$1</span>');
}
        
if ($('#messageSearch').length) {
    $('#messageSearch').on('input', function() {
        const query = $(this).val();
        if (query.length >= 2) {
            $.get('/api/messages/search', { q: query }, function(data) {
                console.log('Search results:', data);
            });
        }
    });
}

$('.card-title').addClass('glow-text');
        
$('body').on('mouseenter', '.card', function() {
    $(this).find('.card-title').addClass('glow-text');
}).on('mouseleave', '.card', function() {
    $(this).find('.card-title').removeClass('glow-text');
});