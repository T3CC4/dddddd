// Mobile Sidebar Toggle
        $(document).ready(function() {
            $('.navbar-toggler').click(function() {
                $('#sidebar').toggleClass('show');
            });
            
            // Close sidebar when clicking outside on mobile
            $(document).click(function(event) {
                if (!$(event.target).closest('#sidebar, .navbar-toggler').length) {
                    $('#sidebar').removeClass('show');
                }
            });
        });

        // Auto-refresh für Dashboard alle 30 Sekunden
        if (window.location.pathname === '/dashboard') {
            setTimeout(() => {
                location.reload();
            }, 30000);
        }
        
        // Search highlight function
        function highlightSearch(text, search) {
            if (!search) return text;
            const regex = new RegExp(`(${search})`, 'gi');
            return text.replace(regex, '<span class="search-highlight">$1</span>');
        }
        
        // AJAX Search für Nachrichten
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

        // Add glow effect to important elements
        $('.card-title').addClass('glow-text');
        
        // Smooth transitions for interactive elements
        $('body').on('mouseenter', '.card', function() {
            $(this).find('.card-title').addClass('glow-text');
        }).on('mouseleave', '.card', function() {
            $(this).find('.card-title').removeClass('glow-text');
        });