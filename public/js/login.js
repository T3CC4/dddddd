 // Form validation enhancement
        document.querySelector('form').addEventListener('submit', function(e) {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const uniquePassword = document.getElementById('uniquePassword').value;
            
            if (!username || !password || !uniquePassword) {
                e.preventDefault();
                
                // Show error styling
                if (!username) document.getElementById('username').style.borderColor = 'var(--danger-color)';
                if (!password) document.getElementById('password').style.borderColor = 'var(--danger-color)';
                if (!uniquePassword) document.getElementById('uniquePassword').style.borderColor = 'var(--danger-color)';
                
                return false;
            }
        });
        
        // Reset border colors on input
        ['username', 'password', 'uniquePassword'].forEach(id => {
            document.getElementById(id).addEventListener('input', function() {
                this.style.borderColor = '';
            });
        });
        
        // Focus first empty field on load
        document.addEventListener('DOMContentLoaded', function() {
            const firstInput = document.getElementById('username');
            if (firstInput) {
                firstInput.focus();
            }
        });