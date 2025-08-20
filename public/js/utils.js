/**
 * Frontend Utility Functions
 * Zentrale Sammlung aller Frontend-Utility-Funktionen
 */

window.SquadUtils = (function() {
    'use strict';

    // Toast System
    const toastSystem = {
        container: null,

        getOrCreateContainer() {
            if (!this.container) {
                this.container = document.getElementById('toast-container');
                if (!this.container) {
                    this.container = document.createElement('div');
                    this.container.id = 'toast-container';
                    this.container.style.cssText = `
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        z-index: 9999;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        max-width: 400px;
                    `;
                    document.body.appendChild(this.container);
                }
            }
            return this.container;
        },

        show(message, type = 'info', duration = 4000) {
            const container = this.getOrCreateContainer();
            const toastId = 'toast-' + Date.now();
            
            const icons = {
                'success': 'fas fa-check-circle',
                'error': 'fas fa-exclamation-circle',
                'warning': 'fas fa-exclamation-triangle',
                'info': 'fas fa-info-circle'
            };
            
            const colors = {
                'success': '#28a745',
                'error': '#dc3545',
                'warning': '#ffc107',
                'info': '#17a2b8'
            };
            
            const toastHtml = `
                <div id="${toastId}" class="toast-notification" style="
                    background: var(--secondary-bg);
                    border-left: 4px solid ${colors[type]};
                    color: var(--text-primary);
                    border-radius: 8px;
                    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
                    transition: all 0.3s ease;
                    margin-bottom: 8px;
                    transform: translateX(0);
                    opacity: 1;
                    animation: slideInRight 0.3s ease;
                ">
                    <div style="display: flex; align-items: center; padding: 12px 16px;">
                        <i class="${icons[type]}" style="color: ${colors[type]}; margin-right: 8px; font-size: 16px;"></i>
                        <span style="flex: 1;">${message}</span>
                        <button onclick="SquadUtils.toast.remove('${toastId}')" style="
                            background: none;
                            border: none;
                            color: var(--text-muted);
                            cursor: pointer;
                            margin-left: 8px;
                            padding: 4px;
                            border-radius: 3px;
                            transition: all 0.2s ease;
                        " onmouseover="this.style.background='var(--primary-pink)'; this.style.color='white';"
                           onmouseout="this.style.background='none'; this.style.color='var(--text-muted)';">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
            
            container.insertAdjacentHTML('beforeend', toastHtml);
            
            setTimeout(() => this.remove(toastId), duration);
        },

        remove(toastId) {
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
    };

    // Clipboard System
    const clipboardSystem = {
        async copy(text) {
            if (!text || text.trim() === '') {
                toastSystem.show('Nichts zum Kopieren vorhanden', 'warning');
                return false;
            }

            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    toastSystem.show('In Zwischenablage kopiert!', 'success');
                    return true;
                } catch (err) {
                    console.warn('Modern clipboard API failed:', err);
                    return this.fallback(text);
                }
            } else {
                return this.fallback(text);
            }
        },

        fallback(text) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 2em;
                height: 2em;
                padding: 0;
                border: none;
                outline: none;
                boxShadow: none;
                background: transparent;
                opacity: 0;
                pointer-events: none;
            `;
            
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    toastSystem.show('In Zwischenablage kopiert!', 'success');
                } else {
                    toastSystem.show('Kopieren fehlgeschlagen', 'error');
                }
                return successful;
            } catch (err) {
                console.error('Fallback copy failed:', err);
                toastSystem.show('Kopieren fehlgeschlagen', 'error');
                return false;
            } finally {
                document.body.removeChild(textArea);
            }
        }
    };

    // Modal System
    const modalSystem = {
        show(title, content, buttons = []) {
            // Remove existing modal
            const existingModal = document.getElementById('dynamicModal');
            if (existingModal) {
                existingModal.remove();
            }

            const modal = document.createElement('div');
            modal.id = 'dynamicModal';
            modal.className = 'modal fade';
            modal.tabIndex = -1;
            modal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content" style="background: var(--secondary-bg); border: 1px solid var(--primary-pink);">
                        <div class="modal-header" style="background: var(--accent-bg); border-bottom: 1px solid var(--primary-pink);">
                            <h5 class="modal-title" style="color: var(--text-primary); font-family: var(--font-heading);">${title}</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" style="background: var(--secondary-bg); color: var(--text-primary);">
                            ${content}
                        </div>
                        <div class="modal-footer" style="background: var(--accent-bg); border-top: 1px solid var(--border-color);"></div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const footer = modal.querySelector('.modal-footer');
            
            buttons.forEach(button => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `btn ${button.class}`;
                btn.textContent = button.text;
                
                if (button.action) {
                    btn.onclick = () => {
                        try {
                            button.action();
                        } catch (error) {
                            console.error('Button action error:', error);
                        }
                        const modalInstance = bootstrap.Modal.getInstance(modal);
                        if (modalInstance) {
                            modalInstance.hide();
                        }
                    };
                } else {
                    btn.setAttribute('data-bs-dismiss', 'modal');
                }
                
                footer.appendChild(btn);
            });

            // Cleanup on hide
            modal.addEventListener('hidden.bs.modal', function () {
                const backdrops = document.querySelectorAll('.modal-backdrop');
                backdrops.forEach(backdrop => backdrop.remove());
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                modal.remove();
            });

            const modalInstance = new bootstrap.Modal(modal, {
                backdrop: true,
                keyboard: true
            });
            modalInstance.show();

            return modalInstance;
        },

        cleanup() {
            const modals = document.querySelectorAll('.modal');
            modals.forEach(modal => {
                const modalInstance = bootstrap.Modal.getInstance(modal);
                if (modalInstance) {
                    modalInstance.hide();
                }
            });

            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(backdrop => backdrop.remove());

            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
    };

    // Form Helpers
    const formHelpers = {
        validate: {
            username(username) {
                if (!username || username.length < 3) {
                    return 'Benutzername muss mindestens 3 Zeichen lang sein';
                }
                if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                    return 'Benutzername darf nur Buchstaben, Zahlen und Unterstriche enthalten';
                }
                return null;
            },

            password(password) {
                if (!password || password.length < 6) {
                    return 'Passwort muss mindestens 6 Zeichen lang sein';
                }
                return null;
            },

            required(value, fieldName = 'Feld') {
                if (!value || value.trim() === '') {
                    return `${fieldName} ist erforderlich`;
                }
                return null;
            }
        },

        clearErrors(formElement) {
            const inputs = formElement.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                input.style.borderColor = '';
                input.classList.remove('is-invalid');
            });
        },

        showError(inputElement, message) {
            inputElement.style.borderColor = 'var(--danger-color)';
            inputElement.classList.add('is-invalid');
            
            let errorDiv = inputElement.parentNode.querySelector('.invalid-feedback');
            if (!errorDiv) {
                errorDiv = document.createElement('div');
                errorDiv.className = 'invalid-feedback';
                inputElement.parentNode.appendChild(errorDiv);
            }
            errorDiv.textContent = message;
        },

        setLoading(buttonElement, loading = true) {
            if (loading) {
                buttonElement.disabled = true;
                buttonElement.dataset.originalText = buttonElement.innerHTML;
                buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wird verarbeitet...';
            } else {
                buttonElement.disabled = false;
                buttonElement.innerHTML = buttonElement.dataset.originalText || buttonElement.innerHTML.replace(/<i[^>]*><\/i>\s*Wird verarbeitet\.\.\./, '');
            }
        }
    };

    // API Helpers
    const apiHelpers = {
        async request(url, options = {}) {
            const defaultOptions = {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            };

            try {
                const response = await fetch(url, { ...defaultOptions, ...options });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `HTTP ${response.status}`);
                }

                return data;
            } catch (error) {
                console.error('API Request failed:', error);
                throw error;
            }
        },

        async get(url) {
            return this.request(url, { method: 'GET' });
        },

        async post(url, data) {
            return this.request(url, {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },

        async put(url, data) {
            return this.request(url, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async delete(url) {
            return this.request(url, { method: 'DELETE' });
        }
    };

    // DOM Helpers
    const domHelpers = {
        ready(callback) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', callback);
            } else {
                callback();
            }
        },

        show(element) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                element.style.display = '';
                element.classList.remove('d-none');
            }
        },

        hide(element) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                element.style.display = 'none';
                element.classList.add('d-none');
            }
        },

        toggle(element) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                if (element.style.display === 'none' || element.classList.contains('d-none')) {
                    this.show(element);
                } else {
                    this.hide(element);
                }
            }
        },

        fadeIn(element, duration = 300) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                element.style.opacity = '0';
                element.style.display = '';
                element.classList.remove('d-none');
                
                const start = performance.now();
                const animate = (currentTime) => {
                    const elapsed = currentTime - start;
                    const progress = Math.min(elapsed / duration, 1);
                    element.style.opacity = progress;
                    
                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    }
                };
                requestAnimationFrame(animate);
            }
        },

        fadeOut(element, duration = 300) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                const start = performance.now();
                const initialOpacity = parseFloat(getComputedStyle(element).opacity);
                
                const animate = (currentTime) => {
                    const elapsed = currentTime - start;
                    const progress = Math.min(elapsed / duration, 1);
                    element.style.opacity = initialOpacity * (1 - progress);
                    
                    if (progress >= 1) {
                        element.style.display = 'none';
                        element.classList.add('d-none');
                    } else {
                        requestAnimationFrame(animate);
                    }
                };
                requestAnimationFrame(animate);
            }
        }
    };

    // URL/Search Helpers
    const urlHelpers = {
        getParam(name) {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get(name);
        },

        setParam(name, value) {
            const url = new URL(window.location);
            url.searchParams.set(name, value);
            window.history.pushState({}, '', url);
        },

        removeParam(name) {
            const url = new URL(window.location);
            url.searchParams.delete(name);
            window.history.pushState({}, '', url);
        },

        highlightSearchTerms(searchTerm, container = document) {
            if (!searchTerm || searchTerm.length < 2) {
                this.removeHighlights(container);
                return;
            }

            const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            const textNodes = [];
            let node;
            while (node = walker.nextNode()) {
                if (node.parentElement.tagName !== 'SCRIPT' && 
                    node.parentElement.tagName !== 'STYLE' &&
                    !node.parentElement.classList.contains('search-highlight')) {
                    textNodes.push(node);
                }
            }

            textNodes.forEach(textNode => {
                const text = textNode.textContent;
                if (regex.test(text)) {
                    const highlightedHTML = text.replace(regex, '<mark class="search-highlight">$1</mark>');
                    const wrapper = document.createElement('span');
                    wrapper.innerHTML = highlightedHTML;
                    textNode.parentNode.replaceChild(wrapper, textNode);
                }
            });
        },

        removeHighlights(container = document) {
            const highlights = container.querySelectorAll('.search-highlight');
            highlights.forEach(highlight => {
                const parent = highlight.parentNode;
                parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
                parent.normalize();
            });
        }
    };

    // Keyboard Handler
    const keyboardHelpers = {
        shortcuts: new Map(),

        register(key, callback, description = '') {
            this.shortcuts.set(key.toLowerCase(), { callback, description });
        },

        unregister(key) {
            this.shortcuts.delete(key.toLowerCase());
        },

        init() {
            document.addEventListener('keydown', (e) => {
                // Don't trigger shortcuts if user is typing in an input
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                    return;
                }

                let shortcutKey = '';
                if (e.ctrlKey || e.metaKey) shortcutKey += 'ctrl+';
                if (e.altKey) shortcutKey += 'alt+';
                if (e.shiftKey) shortcutKey += 'shift+';
                shortcutKey += e.key.toLowerCase();

                const shortcut = this.shortcuts.get(shortcutKey);
                if (shortcut) {
                    e.preventDefault();
                    shortcut.callback(e);
                }
            });

            // Register common shortcuts
            this.register('escape', () => modalSystem.cleanup(), 'Close modals');
            this.register('ctrl+f', (e) => {
                const searchInput = document.querySelector('#search, #discordSearch, #ticketSearch, #logSearch');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                }
            }, 'Focus search');
        },

        getRegistered() {
            return Array.from(this.shortcuts.entries()).map(([key, data]) => ({
                key,
                description: data.description
            }));
        }
    };

    // Storage Helpers
    const storageHelpers = {
        set(key, value, session = false) {
            try {
                const storage = session ? sessionStorage : localStorage;
                storage.setItem(key, JSON.stringify(value));
                return true;
            } catch (error) {
                console.warn('Storage not available:', error);
                return false;
            }
        },

        get(key, defaultValue = null, session = false) {
            try {
                const storage = session ? sessionStorage : localStorage;
                const value = storage.getItem(key);
                return value ? JSON.parse(value) : defaultValue;
            } catch (error) {
                console.warn('Storage not available:', error);
                return defaultValue;
            }
        },

        remove(key, session = false) {
            try {
                const storage = session ? sessionStorage : localStorage;
                storage.removeItem(key);
                return true;
            } catch (error) {
                console.warn('Storage not available:', error);
                return false;
            }
        },

        clear(session = false) {
            try {
                const storage = session ? sessionStorage : localStorage;
                storage.clear();
                return true;
            } catch (error) {
                console.warn('Storage not available:', error);
                return false;
            }
        }
    };

    // Animation Helpers
    const animationHelpers = {
        fadeIn(element, duration = 300, callback = null) {
            domHelpers.fadeIn(element, duration);
            if (callback) {
                setTimeout(callback, duration);
            }
        },

        fadeOut(element, duration = 300, callback = null) {
            domHelpers.fadeOut(element, duration);
            if (callback) {
                setTimeout(callback, duration);
            }
        },

        slideDown(element, duration = 300) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                element.style.height = '0';
                element.style.overflow = 'hidden';
                element.style.display = '';
                
                const targetHeight = element.scrollHeight;
                
                const start = performance.now();
                const animate = (currentTime) => {
                    const elapsed = currentTime - start;
                    const progress = Math.min(elapsed / duration, 1);
                    element.style.height = (targetHeight * progress) + 'px';
                    
                    if (progress >= 1) {
                        element.style.height = '';
                        element.style.overflow = '';
                    } else {
                        requestAnimationFrame(animate);
                    }
                };
                requestAnimationFrame(animate);
            }
        },

        slideUp(element, duration = 300) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                const initialHeight = element.offsetHeight;
                element.style.height = initialHeight + 'px';
                element.style.overflow = 'hidden';
                
                const start = performance.now();
                const animate = (currentTime) => {
                    const elapsed = currentTime - start;
                    const progress = Math.min(elapsed / duration, 1);
                    element.style.height = (initialHeight * (1 - progress)) + 'px';
                    
                    if (progress >= 1) {
                        element.style.display = 'none';
                        element.style.height = '';
                        element.style.overflow = '';
                    } else {
                        requestAnimationFrame(animate);
                    }
                };
                requestAnimationFrame(animate);
            }
        }
    };

    // Date/Time Helpers
    const dateHelpers = {
        formatGerman(date) {
            if (!date) return 'Unbekannt';
            try {
                return new Date(date).toLocaleString('de-DE');
            } catch (error) {
                return 'Ungültiges Datum';
            }
        },

        formatGermanDate(date) {
            if (!date) return 'Unbekannt';
            try {
                return new Date(date).toLocaleDateString('de-DE');
            } catch (error) {
                return 'Ungültiges Datum';
            }
        },

        formatGermanTime(date) {
            if (!date) return 'Unbekannt';
            try {
                return new Date(date).toLocaleTimeString('de-DE');
            } catch (error) {
                return 'Ungültige Zeit';
            }
        },

        timeAgo(timestamp) {
            if (!timestamp) return 'Unbekannt';
            
            const now = new Date();
            const time = new Date(timestamp);
            
            if (isNaN(time.getTime())) {
                return 'Unbekannt';
            }
            
            const diffInSeconds = Math.floor((now - time) / 1000);
            
            if (diffInSeconds < 60) {
                return 'vor wenigen Sekunden';
            } else if (diffInSeconds < 3600) {
                const minutes = Math.floor(diffInSeconds / 60);
                return `vor ${minutes} Minute${minutes !== 1 ? 'n' : ''}`;
            } else if (diffInSeconds < 86400) {
                const hours = Math.floor(diffInSeconds / 3600);
                return `vor ${hours} Stunde${hours !== 1 ? 'n' : ''}`;
            } else if (diffInSeconds < 604800) {
                const days = Math.floor(diffInSeconds / 86400);
                return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
            } else {
                return time.toLocaleDateString('de-DE');
            }
        },

        isToday(date) {
            const today = new Date();
            const checkDate = new Date(date);
            return today.toDateString() === checkDate.toDateString();
        },

        isThisWeek(date) {
            const now = new Date();
            const checkDate = new Date(date);
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return checkDate >= weekAgo && checkDate <= now;
        }
    };

    // Export/Import Helpers
    const exportHelpers = {
        downloadJSON(data, filename) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { 
                type: 'application/json;charset=utf-8;' 
            });
            this.downloadBlob(blob, filename || `export_${Date.now()}.json`);
        },

        downloadCSV(data, filename, headers = null) {
            let csv = '';
            
            if (headers) {
                csv += headers.join(',') + '\n';
            }
            
            if (Array.isArray(data)) {
                data.forEach(row => {
                    if (Array.isArray(row)) {
                        csv += row.map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
                    } else if (typeof row === 'object') {
                        const values = headers ? headers.map(h => row[h] || '') : Object.values(row);
                        csv += values.map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
                    }
                });
            }
            
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            this.downloadBlob(blob, filename || `export_${Date.now()}.csv`);
        },

        downloadText(text, filename) {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
            this.downloadBlob(blob, filename || `export_${Date.now()}.txt`);
        },

        downloadBlob(blob, filename) {
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            URL.revokeObjectURL(url);
        }
    };

    // Loading States
    const loadingHelpers = {
        show(element, text = 'Lädt...') {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element) {
                element.dataset.originalContent = element.innerHTML;
                element.innerHTML = `
                    <div class="d-flex justify-content-center align-items-center">
                        <i class="fas fa-spinner fa-spin me-2"></i>
                        ${text}
                    </div>
                `;
                element.style.opacity = '0.7';
                element.style.pointerEvents = 'none';
            }
        },

        hide(element) {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }
            if (element && element.dataset.originalContent) {
                element.innerHTML = element.dataset.originalContent;
                element.style.opacity = '';
                element.style.pointerEvents = '';
                delete element.dataset.originalContent;
            }
        },

        showSpinner(container, size = 'normal') {
            const sizeClass = size === 'small' ? 'fa-sm' : size === 'large' ? 'fa-2x' : '';
            const spinner = document.createElement('div');
            spinner.className = 'loading-spinner-container text-center';
            spinner.innerHTML = `
                <i class="fas fa-spinner fa-spin ${sizeClass} text-primary"></i>
                <p class="mt-2 text-muted">Lädt...</p>
            `;
            
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            if (container) {
                container.appendChild(spinner);
            }
            
            return spinner;
        },

        removeSpinner(container) {
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            if (container) {
                const spinner = container.querySelector('.loading-spinner-container');
                if (spinner) {
                    spinner.remove();
                }
            }
        }
    };

    // Initialize keyboard shortcuts
    domHelpers.ready(() => {
        keyboardHelpers.init();
    });

    // Add toast animation styles
    const toastStyles = `
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
        
        .search-highlight {
            background: linear-gradient(45deg, var(--primary-pink), var(--accent-pink));
            color: white;
            padding: 2px 6px;
            border-radius: var(--border-radius-sm);
            font-weight: bold;
        }
        
        .loading-spinner-container {
            padding: 2rem;
        }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.textContent = toastStyles;
    document.head.appendChild(styleSheet);

    // Public API
    return {
        // Main systems
        toast: toastSystem,
        clipboard: clipboardSystem,
        modal: modalSystem,
        form: formHelpers,
        api: apiHelpers,
        dom: domHelpers,
        url: urlHelpers,
        keyboard: keyboardHelpers,
        storage: storageHelpers,
        animation: animationHelpers,
        date: dateHelpers,
        export: exportHelpers,
        loading: loadingHelpers,

        // Convenience methods
        showToast: (message, type, duration) => toastSystem.show(message, type, duration),
        copyToClipboard: (text) => clipboardSystem.copy(text),
        showModal: (title, content, buttons) => modalSystem.show(title, content, buttons),
        
        // Common shortcuts
        ready: (callback) => domHelpers.ready(callback),
        show: (element) => domHelpers.show(element),
        hide: (element) => domHelpers.hide(element),
        toggle: (element) => domHelpers.toggle(element),
        
        // Utilities
        debounce: (func, wait) => {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        throttle: (func, limit) => {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },

        formatFileSize: (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },

        escapeHtml: (text) => {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, (m) => map[m]);
        },

        generateId: () => {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        },

        // Version info
        version: '1.1.0',
        
        // Debug helpers
        debug: {
            info: () => ({
                toasts: document.querySelectorAll('[id^="toast-"]').length,
                modals: document.querySelectorAll('.modal.show').length,
                shortcuts: keyboardHelpers.getRegistered().length,
                version: '1.1.0'
            }),
            
            shortcuts: () => keyboardHelpers.getRegistered(),
            
            storage: () => ({
                localStorage: storageHelpers.get('debug-test') !== null,
                sessionStorage: storageHelpers.get('debug-test', null, true) !== null
            })
        }
    };
})();

// Backward compatibility aliases
window.showToast = window.SquadUtils.showToast;
window.copyToClipboard = window.SquadUtils.copyToClipboard;
window.showModal = window.SquadUtils.showModal;

console.log('🚀 14th Squad Utils v1.1.0 loaded successfully');