// Discord Avatar Helper - Echte Profilbilder laden
class DiscordAvatarHelper {
    constructor() {
        this.cache = new Map();
        this.loadingSet = new Set();
        this.apiEndpoint = '/api/discord/users';
        this.retryCount = new Map();
        this.maxRetries = 3;
        
        // Default Discord Avatar URLs
        this.defaultAvatars = [
            'https://cdn.discordapp.com/embed/avatars/0.png',
            'https://cdn.discordapp.com/embed/avatars/1.png',
            'https://cdn.discordapp.com/embed/avatars/2.png',
            'https://cdn.discordapp.com/embed/avatars/3.png',
            'https://cdn.discordapp.com/embed/avatars/4.png',
            'https://cdn.discordapp.com/embed/avatars/5.png'
        ];
        
        console.log('🖼️ Discord Avatar Helper initialisiert');
        this.initializeObserver();
    }

    // Generiere Avatar URL basierend auf User ID und Hash
    generateAvatarUrl(userId, avatarHash = null, discriminator = null, size = 128) {
        try {
            if (avatarHash && avatarHash !== 'null' && avatarHash !== '') {
                // Echtes Profilbild mit Hash
                const extension = avatarHash.startsWith('a_') ? 'gif' : 'png';
                return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=${size}`;
            }
            
            // Default Avatar berechnen
            return this.generateDefaultAvatarUrl(userId, discriminator);
        } catch (error) {
            console.warn('Fehler beim Generieren der Avatar URL:', error);
            return this.generateDefaultAvatarUrl(userId, discriminator);
        }
    }

    // Generiere Default Avatar URL
    generateDefaultAvatarUrl(userId, discriminator = null) {
        try {
            if (discriminator && discriminator !== '0') {
                // Alte Methode mit Discriminator (vor 2023)
                return this.defaultAvatars[parseInt(discriminator) % this.defaultAvatars.length];
            }
            
            // Neue Methode mit User ID (nach 2023)
            const userIdBigInt = BigInt(userId);
            const defaultAvatarNumber = Number((userIdBigInt >> 22n) % BigInt(this.defaultAvatars.length));
            return this.defaultAvatars[defaultAvatarNumber];
        } catch (error) {
            console.warn('Fehler beim Berechnen des Default Avatars:', error);
            return this.defaultAvatars[0]; // Fallback
        }
    }

    // Lade User-Informationen über API
    async fetchUserInfo(userId) {
        try {
            const response = await fetch(`${this.apiEndpoint}/${userId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.user || null;
            }
        } catch (error) {
            console.log(`API für User ${userId} nicht verfügbar:`, error.message);
        }
        
        return null;
    }

    // Lade Avatar mit Fallback und Caching
    async loadUserAvatar(userId, avatarHash = null, discriminator = null, username = null) {
        const cacheKey = `${userId}-${avatarHash || 'default'}`;
        
        // Check Cache
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Prevent multiple simultaneous requests
        if (this.loadingSet.has(cacheKey)) {
            return new Promise(resolve => {
                const checkCache = () => {
                    if (this.cache.has(cacheKey)) {
                        resolve(this.cache.get(cacheKey));
                    } else {
                        setTimeout(checkCache, 100);
                    }
                };
                checkCache();
            });
        }

        this.loadingSet.add(cacheKey);

        try {
            // Versuche zuerst mit vorhandenen Daten
            let finalAvatarHash = avatarHash;
            let finalDiscriminator = discriminator;
            let finalUsername = username;

            // Wenn keine Avatar-Daten vorhanden, versuche API
            if (!avatarHash || avatarHash === 'null') {
                const userInfo = await this.fetchUserInfo(userId);
                if (userInfo) {
                    finalAvatarHash = userInfo.avatar;
                    finalDiscriminator = userInfo.discriminator;
                    finalUsername = userInfo.username || username;
                }
            }

            // Generiere Avatar URL
            const avatarUrl = this.generateAvatarUrl(userId, finalAvatarHash, finalDiscriminator);
            
            // Test if image loads
            const isValid = await this.testImageLoad(avatarUrl);
            
            if (isValid) {
                const result = {
                    url: avatarUrl,
                    username: finalUsername || 'Unbekannt',
                    hasCustomAvatar: !!(finalAvatarHash && finalAvatarHash !== 'null'),
                    discriminator: finalDiscriminator
                };
                
                this.cache.set(cacheKey, result);
                return result;
            } else {
                throw new Error('Avatar konnte nicht geladen werden');
            }
        } catch (error) {
            // Fallback to default avatar
            console.log(`Fallback für User ${userId}:`, error.message);
            const defaultUrl = this.generateDefaultAvatarUrl(userId, discriminator);
            
            const result = {
                url: defaultUrl,
                username: username || 'Unbekannt',
                hasCustomAvatar: false,
                discriminator: discriminator
            };
            
            this.cache.set(cacheKey, result);
            return result;
        } finally {
            this.loadingSet.delete(cacheKey);
        }
    }

    // Teste ob ein Bild geladen werden kann
    async testImageLoad(url) {
        return new Promise((resolve) => {
            const img = new Image();
            const timeout = setTimeout(() => {
                resolve(false);
            }, 5000); // 5 Sekunden Timeout
            
            img.onload = () => {
                clearTimeout(timeout);
                resolve(true);
            };
            
            img.onerror = () => {
                clearTimeout(timeout);
                resolve(false);
            };
            
            img.src = url;
        });
    }

    // Update ein einzelnes Avatar-Element
    async updateAvatarElement(element) {
        const userId = element.getAttribute('data-user-id');
        const avatarHash = element.getAttribute('data-avatar-hash');
        const discriminator = element.getAttribute('data-discriminator');
        const username = element.getAttribute('data-username') || element.alt || '';
        
        if (!userId || userId === 'SYSTEM') {
            return; // Skip System-Nachrichten
        }

        try {
            // Zeige Loading-Indikator
            this.showLoadingState(element);
            
            const avatarData = await this.loadUserAvatar(userId, avatarHash, discriminator, username);
            
            // Update das Element
            this.applyAvatarToElement(element, avatarData);
            
        } catch (error) {
            console.error(`Fehler beim Laden des Avatars für ${userId}:`, error);
            this.showErrorState(element);
        }
    }

    // Zeige Loading-State
    showLoadingState(element) {
        if (element.tagName === 'IMG') {
            const placeholder = this.createPlaceholderDiv();
            placeholder.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            element.parentNode.replaceChild(placeholder, element);
        } else if (element.classList.contains('user-avatar')) {
            element.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            element.style.opacity = '0.6';
        }
    }

    // Zeige Error-State
    showErrorState(element) {
        if (element.classList.contains('user-avatar')) {
            element.innerHTML = '<i class="fas fa-user"></i>';
            element.style.opacity = '1';
        }
    }

    // Wende Avatar-Daten auf Element an
    applyAvatarToElement(element, avatarData) {
        const { url, username, hasCustomAvatar } = avatarData;
        
        if (element.tagName === 'IMG') {
            // Bereits ein IMG-Element
            element.src = url;
            element.alt = `${username} Avatar`;
            element.title = username;
            element.style.opacity = '1';
            this.applyAvatarStyles(element, hasCustomAvatar);
        } else {
            // Ersetze mit IMG-Element
            const img = document.createElement('img');
            img.src = url;
            img.alt = `${username} Avatar`;
            img.title = username;
            img.className = element.className.replace(/avatar\b/, 'discord-avatar-img');
            this.applyAvatarStyles(img, hasCustomAvatar);
            
            // Kopiere style-Attribute
            if (element.style.cssText) {
                img.style.cssText = element.style.cssText;
            }
            
            element.parentNode.replaceChild(img, element);
        }
    }

    // Wende Avatar-Styles an
    applyAvatarStyles(imgElement, hasCustomAvatar) {
        imgElement.style.cssText += `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid ${hasCustomAvatar ? 'var(--primary-pink)' : 'var(--border-color)'};
            transition: all 0.3s ease;
        `;
        
        // Hover-Effekte
        imgElement.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 0 15px var(--glow-pink)';
        });
        
        imgElement.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = 'none';
        });
    }

    // Erstelle Placeholder Div
    createPlaceholderDiv() {
        const div = document.createElement('div');
        div.className = 'discord-avatar user-avatar loading';
        div.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--secondary-bg);
            border: 2px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
        `;
        return div;
    }

    // Update alle Avatare auf der Seite
    async updateAllAvatars() {
        const avatarElements = document.querySelectorAll('[data-user-id]:not([data-user-id="SYSTEM"])');
        console.log(`🔄 Aktualisiere ${avatarElements.length} Avatar(e)...`);
        
        // Batch-Verarbeitung für bessere Performance
        const batchSize = 5;
        for (let i = 0; i < avatarElements.length; i += batchSize) {
            const batch = Array.from(avatarElements).slice(i, i + batchSize);
            await Promise.all(batch.map(element => this.updateAvatarElement(element)));
            
            // Kurze Pause zwischen Batches
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('✅ Avatar-Update abgeschlossen');
    }

    // Intersection Observer für Lazy Loading
    initializeObserver() {
        if ('IntersectionObserver' in window) {
            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.updateAvatarElement(entry.target);
                        this.observer.unobserve(entry.target);
                    }
                });
            }, {
                rootMargin: '50px'
            });
        }
    }

    // Beobachte neue Avatar-Elemente für Lazy Loading
    observeNewAvatars() {
        if (this.observer) {
            const newAvatars = document.querySelectorAll('[data-user-id]:not([data-observed]):not([data-user-id="SYSTEM"])');
            newAvatars.forEach(element => {
                element.setAttribute('data-observed', 'true');
                this.observer.observe(element);
            });
        }
    }

    // Cache-Management
    clearCache() {
        this.cache.clear();
        this.retryCount.clear();
        console.log('🗑️ Avatar-Cache geleert');
    }

    getCacheInfo() {
        return {
            size: this.cache.size,
            loading: this.loadingSet.size,
            retries: this.retryCount.size
        };
    }

    // Batch-Update für bessere Performance
    async batchUpdateAvatars(userIds) {
        console.log(`📦 Batch-Update für ${userIds.length} Benutzer...`);
        
        try {
            // Versuche Batch-API-Aufruf
            const response = await fetch(`${this.apiEndpoint}/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ userIds })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.users) {
                    // Verwende Batch-Daten
                    data.users.forEach(userInfo => {
                        const cacheKey = `${userInfo.id}-${userInfo.avatar || 'default'}`;
                        const avatarUrl = this.generateAvatarUrl(userInfo.id, userInfo.avatar, userInfo.discriminator);
                        
                        this.cache.set(cacheKey, {
                            url: avatarUrl,
                            username: userInfo.username,
                            hasCustomAvatar: !!userInfo.avatar,
                            discriminator: userInfo.discriminator
                        });
                    });
                    
                    // Update alle Elemente mit den gecachten Daten
                    userIds.forEach(userId => {
                        const elements = document.querySelectorAll(`[data-user-id="${userId}"]`);
                        elements.forEach(element => {
                            const cacheKey = `${userId}-${element.getAttribute('data-avatar-hash') || 'default'}`;
                            const avatarData = this.cache.get(cacheKey);
                            if (avatarData) {
                                this.applyAvatarToElement(element, avatarData);
                            }
                        });
                    });
                    
                    console.log('✅ Batch-Update erfolgreich');
                    return;
                }
            }
        } catch (error) {
            console.log('Batch-API nicht verfügbar, verwende Einzelanfragen:', error.message);
        }
        
        // Fallback: Einzelne Updates
        await this.updateAllAvatars();
    }

    // Debug-Informationen
    getDebugInfo() {
        return {
            cache: this.getCacheInfo(),
            loadingElements: document.querySelectorAll('[data-user-id] .fa-spinner').length,
            totalAvatars: document.querySelectorAll('[data-user-id]').length,
            systemAvatars: document.querySelectorAll('[data-user-id="SYSTEM"]').length
        };
    }
}

// Globale Instanz
const discordAvatars = new DiscordAvatarHelper();

// Auto-Initialisierung
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Discord Avatar System gestartet');
    
    // Warte kurz, dann starte Avatar-Updates
    setTimeout(() => {
        discordAvatars.observeNewAvatars();
        discordAvatars.updateAllAvatars();
    }, 500);
    
    // Beobachte DOM-Änderungen für dynamisch hinzugefügte Avatare
    if ('MutationObserver' in window) {
        const mutationObserver = new MutationObserver((mutations) => {
            let hasNewAvatars = false;
            
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        // Prüfe ob neue Avatar-Elemente hinzugefügt wurden
                        if (node.hasAttribute && node.hasAttribute('data-user-id')) {
                            hasNewAvatars = true;
                        }
                        
                        // Prüfe auch Kinder
                        const avatarChildren = node.querySelectorAll ? node.querySelectorAll('[data-user-id]') : [];
                        if (avatarChildren.length > 0) {
                            hasNewAvatars = true;
                        }
                    }
                });
            });
            
            if (hasNewAvatars) {
                setTimeout(() => {
                    discordAvatars.observeNewAvatars();
                }, 100);
            }
        });
        
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
});

// Utility-Funktionen für Templates und andere Scripts
function getDiscordAvatarUrl(userId, avatarHash = null, discriminator = null) {
    return discordAvatars.generateAvatarUrl(userId, avatarHash, discriminator);
}

function updateUserAvatar(userId) {
    const elements = document.querySelectorAll(`[data-user-id="${userId}"]`);
    elements.forEach(element => {
        discordAvatars.updateAvatarElement(element);
    });
}

function refreshAllAvatars() {
    discordAvatars.clearCache();
    discordAvatars.updateAllAvatars();
}

// Debug-Funktionen (für Entwicklung)
function getAvatarDebugInfo() {
    return discordAvatars.getDebugInfo();
}

function clearAvatarCache() {
    discordAvatars.clearCache();
    console.log('Avatar-Cache geleert');
}

// Export für Module (falls verwendet)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DiscordAvatarHelper,
        getDiscordAvatarUrl,
        updateUserAvatar,
        refreshAllAvatars
    };
}

// Mache Funktionen global verfügbar
window.DiscordAvatars = {
    helper: discordAvatars,
    getUrl: getDiscordAvatarUrl,
    update: updateUserAvatar,
    refresh: refreshAllAvatars,
    debug: getAvatarDebugInfo,
    clearCache: clearAvatarCache
};