/**
 * Animated Heart Pulse Effect for Favorite Properties
 * Handles favorite property interactions with animations
 */

class FavoritesManager {
    constructor() {
        // Clear old localStorage favorites to prevent conflicts
        if (localStorage.getItem('favorites')) {
            console.log('Clearing old localStorage favorites to prevent conflicts');
            localStorage.removeItem('favorites');
        }
        
        // Для менеджеров НЕ загружаем из localStorage
        if (this.isManager()) {
            this.favorites = [];
            this.favoriteComplexes = [];
            console.log('Manager detected: Skipping localStorage, will load from API');
        } else {
            this.favorites = this.loadFavorites();
            this.favoriteComplexes = this.loadFavoriteComplexes();
        }
        
        this.init();
    }

    // Helper function to get CSRF token from meta tag
    getCSRFToken() {
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta) {
            return csrfMeta.getAttribute('content');
        }
        
        // Fallback check for other possible CSRF token locations
        const csrfInput = document.querySelector('input[name="csrf_token"]');
        if (csrfInput) {
            return csrfInput.value;
        }
        
        console.warn('CSRF token not found in page');
        return null;
    }

    // Centralized manager detection method
    isManager() {
        // Use server-side authentication data, not DOM elements
        // Handle null, undefined and false as NON-manager
        return Boolean(window.manager_authenticated);
    }

    async init() {
        this.bindEvents();
        
        // ✅ ОПТИМИЗАЦИЯ: Ждём bootstrap или используем его данные
        if (window.dashboardBootstrapLoaded && window.dashboardBootstrapData) {
            console.log('⚡ Favorites: Using cached bootstrap data');
            const data = window.dashboardBootstrapData;
            this.favorites = data.favorites?.properties?.map(p => String(p.id)) || [];
            this.complexFavorites = data.favorites?.complexes?.map(c => String(c.id)) || [];
        } else if (window.location.pathname === '/dashboard') {
            // На дашборде ждём bootstrap вместо отдельного API
            console.log('⏳ Favorites: Waiting for bootstrap on dashboard...');
            return; // Bootstrap сам обновит UI
        } else {
            await this.loadFavoritesFromAPI();
        }
        
        this.updateFavoritesUI();
        this.updateComplexFavoritesUI();
        this.updateFavoritesCounter();
    }

    bindEvents() {
        // Handle heart clicks - using event delegation for better compatibility
        document.addEventListener('click', (e) => {
            let heartElement = null;
            
            // Check if the clicked element has favorite-heart class
            if (e.target && e.target.classList && e.target.classList.contains('favorite-heart')) {
                heartElement = e.target;
            }
            // Check if the clicked element is inside a favorite-heart
            else if (e.target && e.target.closest) {
                heartElement = e.target.closest('.favorite-heart');
            }
            // Fallback for older browsers
            else if (e.target) {
                let element = e.target;
                while (element && element !== document) {
                    if (element.classList && element.classList.contains('favorite-heart')) {
                        heartElement = element;
                        break;
                    }
                    element = element.parentElement;
                }
            }
            
            if (heartElement && heartElement.dataset.propertyId) {
                const propertyId = heartElement.dataset.propertyId;
                this.toggleFavorite(propertyId, heartElement);
                e.preventDefault();
                e.stopPropagation();
            }
            
            // Handle complex heart clicks
            if (heartElement && heartElement.dataset.complexId) {
                const complexId = heartElement.dataset.complexId;
                this.toggleComplexFavorite(complexId, heartElement);
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Handle property card hover for pulse effect
        document.addEventListener('mouseenter', (e) => {
            const card = e.target && e.target.closest ? e.target.closest('.property-card') : null;
            if (card) {
                const heart = card.querySelector('.favorite-heart');
                if (heart && !heart.classList.contains('favorited')) {
                    heart.classList.add('pulse');
                }
            }
        }, true);

        document.addEventListener('mouseleave', (e) => {
            const card = e.target && e.target.closest ? e.target.closest('.property-card') : null;
            if (card) {
                const heart = card.querySelector('.favorite-heart');
                if (heart) {
                    heart.classList.remove('pulse');
                }
            }
        }, true);
    }

    async toggleFavorite(propertyId, heartElement) {
        // Check if user is authenticated - improved check
        const dashboardLink = document.querySelector('a[href*="dashboard"]');
        const logoutLink = document.querySelector('a[href*="logout"]');
        const userNameElement = document.querySelector('.user-name');
        const isAuthenticated = dashboardLink !== null || logoutLink !== null || userNameElement !== null;
        
        console.log('Auth check:', {
            dashboardLink: !!dashboardLink,
            logoutLink: !!logoutLink,
            userNameElement: !!userNameElement,
            isAuthenticated
        });
        
        if (!isAuthenticated) {
            this.showAuthRequiredMessage('избранное');
            return;
        }
        
        // Show loading state
        heartElement.style.opacity = '0.5';
        
        try {
            // Check if user is a manager and use appropriate endpoint
            const endpoint = this.isManager() ? '/api/manager/favorites/toggle' : '/api/favorites/toggle';
            
            // Get property data for API call
            const propertyCard = heartElement.closest('.property-card') || heartElement.closest('[data-property-id]');
            const propertyData = this.extractPropertyData(propertyCard, propertyId);
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCSRFToken()
                },
                body: JSON.stringify({
                    property_id: propertyId,
                    ...propertyData
                })
            });
            
            const result = await response.json();
            
            console.log('API response:', result);
            
            if (result.success) {
                if (result.action === 'added') {
                    this.addFavoriteVisual(propertyId, heartElement);
                    this.showNotification(`Добавлено в избранное`, 'success');
                } else {
                    this.removeFavoriteVisual(propertyId, heartElement);
                    this.showNotification(`Удалено из избранного`, 'info');
                }
                
                // Для менеджеров - перезагрузить из API, для пользователей - обновить локальное состояние
                if (this.isManager()) {
                    await this.loadFavoritesFromAPI();
                } else {
                    // Update local state for regular users
                    if (result.is_favorite) {
                        if (!this.favorites.includes(String(propertyId))) {
                            this.favorites.push(String(propertyId));
                        }
                    } else {
                        this.favorites = this.favorites.filter(id => id !== String(propertyId));
                    }
                    this.saveFavorites();
                }
                
                this.updateFavoritesCounter();
            } else {
                console.error('API error:', result.error);
                this.showNotification(result.error || 'Ошибка при обновлении избранного', 'error');
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            console.error('Property data sent:', {
                property_id: propertyId,
                ...this.extractPropertyData(heartElement.closest('.property-card') || heartElement.closest('[data-property-id]'), propertyId)
            });
            this.showNotification('Ошибка при обновлении избранного', 'error');
        } finally {
            // Restore opacity
            heartElement.style.opacity = '1';
        }
    }

    addFavoriteVisual(propertyId, heartElement) {        
        // Visual feedback
        heartElement.classList.add('animate-click', 'favorited', 'pulse');
        
        // Update title
        heartElement.title = 'Удалить из избранного';
        
        // Create floating hearts effect
        this.createFloatingHearts(heartElement);
        
        // Remove animation classes after animation completes
        setTimeout(() => {
            heartElement.classList.remove('animate-click');
        }, 300);
        
        // Keep pulse for a bit longer
        setTimeout(() => {
            heartElement.classList.remove('pulse');
        }, 1500);
    }

    removeFavoriteVisual(propertyId, heartElement) {
        // Visual feedback
        heartElement.classList.add('animate-click');
        heartElement.classList.remove('favorited', 'pulse');
        
        // Update title
        heartElement.title = 'Добавить в избранное';
        
        setTimeout(() => {
            heartElement.classList.remove('animate-click');
        }, 300);
    }
    
    extractPropertyData(propertyCard, propertyId) {
        // Extract property data from DOM for API call
        const data = { property_id: propertyId };
        
        if (propertyCard) {
            const titleElement = propertyCard.querySelector('.property-title, h3, [data-property-title]');
            const priceElement = propertyCard.querySelector('.property-price, [data-property-price]');
            const complexElement = propertyCard.querySelector('.complex-name, [data-complex-name]');
            const developerElement = propertyCard.querySelector('.developer-name, [data-developer-name]');
            const typeElement = propertyCard.querySelector('.property-type, [data-property-type]');
            const sizeElement = propertyCard.querySelector('.property-size, [data-property-size]');
            const imageElement = propertyCard.querySelector('img');
            
            if (titleElement) data.property_name = titleElement.textContent?.trim() || '';
            if (priceElement) {
                const priceText = priceElement.textContent?.replace(/[^\d]/g, '') || '0';
                data.property_price = parseInt(priceText) || 0;
            }
            if (complexElement) data.complex_name = complexElement.textContent?.trim() || '';
            if (developerElement) data.developer_name = developerElement.textContent?.trim() || '';
            if (typeElement) data.property_type = typeElement.textContent?.trim() || '';
            if (sizeElement) {
                const sizeText = sizeElement.textContent?.replace(/[^\d.]/g, '') || '0';
                data.property_size = parseFloat(sizeText) || 0;
            }
            if (imageElement) data.property_image = imageElement.src || '';
            
            // Calculate cashback (5% default)
            if (data.property_price) {
                data.cashback_amount = Math.round(data.property_price * 0.05);
                data.cashback_percent = 5.0;
            }
        }
        
        return data;
    }

    createFloatingHearts(heartElement) {
        const rect = heartElement.getBoundingClientRect();
        const heartsCount = 3;
        
        for (let i = 0; i < heartsCount; i++) {
            setTimeout(() => {
                const floatingHeart = document.createElement('div');
                floatingHeart.className = 'floating-heart';
                floatingHeart.innerHTML = '<i class="fas fa-heart"></i>';
                
                // Random positioning around the heart
                const randomX = (Math.random() - 0.5) * 40;
                const randomY = (Math.random() - 0.5) * 20;
                
                floatingHeart.style.left = `${rect.left + rect.width/2 + randomX}px`;
                floatingHeart.style.top = `${rect.top + rect.height/2 + randomY}px`;
                
                document.body.appendChild(floatingHeart);
                
                // Remove after animation
                setTimeout(() => {
                    floatingHeart.remove();
                }, 2000);
            }, i * 100);
        }
    }

    updateFavoritesUI() {
        const hearts = document.querySelectorAll('.favorite-heart');
        console.log(`🔄 updateFavoritesUI: Found ${hearts.length} property hearts, favorites:`, this.favorites);
        
        hearts.forEach((heart, index) => {
            const propertyId = heart.dataset.propertyId;
            const isFavorited = this.favorites.includes(String(propertyId));
            console.log(`  Heart ${index + 1}: ID=${propertyId}, isFavorited=${isFavorited}`);
            
            if (isFavorited) {
                heart.classList.add('favorited');
                heart.title = 'Удалить из избранного';
            } else {
                heart.classList.remove('favorited');
                heart.title = 'Добавить в избранное';
            }
        });
    }

    async updateFavoritesCounter() {
        try {
            // Use appropriate endpoint based on user type
            const endpoint = this.isManager() ? '/api/manager/favorites/count' : '/api/favorites/count';
            const response = await fetch(endpoint);
            if (!response.ok) {
                console.warn('⚠️ Failed to fetch favorites count from API');
                return; // Don't update counters if API fails
            }
            
            const data = await response.json();
            if (!data.success) {
                console.warn('⚠️ API returned unsuccessful response');
                return; // Don't update counters if API returns error
            }
            
            // Use total_count which includes both properties and complexes
            const realCount = data.total_count || 0;
            const propertiesCount = data.properties_count || 0;
            const complexesCount = data.complexes_count || 0;
            
            console.log(`✅ Real favorites count from API - Total: ${realCount} (Properties: ${propertiesCount}, Complexes: ${complexesCount})`);
            
            // Update dashboard counters
            const dashboardCounter = document.getElementById('favorites-count');
            if (dashboardCounter) {
                dashboardCounter.textContent = propertiesCount; // Show ONLY properties
                console.log(`  📕 Updated #favorites-count: ${propertiesCount}`);
            }
            
            const complexCounter = document.getElementById('complex-favorites-count');
            if (complexCounter) {
                complexCounter.textContent = complexesCount; // Show ONLY complexes
                console.log(`  🏢 Updated #complex-favorites-count: ${complexesCount}`);
            }
            
            const totalCounter = document.getElementById('total-favorites-count');
            if (totalCounter) {
                totalCounter.textContent = realCount; // Show total (properties + complexes)
                console.log(`  📊 Updated #total-favorites-count: ${realCount}`);
            }
            
            const topCounter = document.getElementById('top-favorites-count');
            if (topCounter) {
                topCounter.textContent = realCount; // Show total in sidebar
                console.log(`  🔝 Updated #top-favorites-count (sidebar): ${realCount}`);
            }
            
            // Update badge counters
            const counters = document.querySelectorAll('.favorites-counter .badge');
            counters.forEach(badge => {
                if (realCount > 0) {
                    badge.textContent = realCount;
                    badge.classList.add('show');
                    
                    // Pulse animation for updates
                    badge.classList.add('pulse');
                    setTimeout(() => {
                        badge.classList.remove('pulse');
                    }, 600);
                } else {
                    badge.classList.remove('show');
                }
            });
            
            // Update favorites page link
            this.updateFavoritesPageLink(realCount);
            
            // Set window variables for header heart (used by authenticated users)
            window.favoritesCount = propertiesCount;
            window.complexFavoritesCount = complexesCount;
            
            // After updating counters, also update header heart
            if (typeof window.updateHeaderFavoritesHeart === 'function') {
                window.updateHeaderFavoritesHeart();
            }
            
        } catch (error) {
            console.error('❌ Error updating favorites counter:', error);
        }
    }

    updateFavoritesPageLink(count = null) {
        const favoritesLinks = document.querySelectorAll('a[href*="favorites"]');
        const totalCount = count !== null ? count : (this.favorites.length + this.favoriteComplexes.length);
        
        favoritesLinks.forEach(link => {
            const text = link.querySelector('.nav-text');
            if (text) {
                text.textContent = totalCount > 0 ? `Избранное (${totalCount})` : 'Избранное';
            }
        });
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg transition-all duration-300 transform translate-x-full`;
        
        // Style based on type
        if (type === 'success') {
            notification.classList.add('bg-green-500', 'text-white');
            notification.innerHTML = `<i class="fas fa-heart mr-2"></i>${message}`;
        } else {
            notification.classList.add('bg-blue-500', 'text-white');
            notification.innerHTML = `<i class="fas fa-info-circle mr-2"></i>${message}`;
        }
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);
        
        // Animate out and remove
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }

    loadFavorites() {
        try {
            const stored = localStorage.getItem('inback_favorites');
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error loading favorites:', error);
            return [];
        }
    }

    // Load favorites from API for managers
    async loadFavoritesFromAPI() {
        const isManager = this.isManager();
        console.log(`🔥 loadFavoritesFromAPI called for ${isManager ? 'manager' : 'user'}`);
        
        // ⚡ PERFORMANCE: Check if bootstrap data is available (avoids redundant API call)
        if (!isManager && window.dashboardBootstrapData && window.dashboardBootstrapLoaded) {
            console.log('⚡ Using bootstrap data for favorites (skipping API call)');
            const bootstrapFavorites = window.dashboardBootstrapData.favorites;
            this.favorites = bootstrapFavorites.properties.map(p => p.id);
            this.favoriteComplexes = bootstrapFavorites.complexes.map(c => ({ id: c.id }));
            console.log(`📦 Loaded from bootstrap: ${this.favorites.length} properties, ${this.favoriteComplexes.length} complexes`);
            return;
        }
        
        console.log(`🔍 DEBUG: window.manager_authenticated =`, window.manager_authenticated);
        console.log(`🔍 DEBUG: window.isManager =`, window.isManager);
        console.log(`🔍 DEBUG: this.isManager() =`, isManager);
        
        try {
            // ✅ ИСПРАВЛЕНО: Используем правильные endpoint'ы в зависимости от типа пользователя
            const favoritesEndpoint = isManager ? '/api/manager/favorites/list' : '/api/favorites/list';
            const complexesEndpoint = isManager ? '/api/manager/complexes/favorites/list' : '/api/complexes/favorites/list';
            
            console.log(`🔍 DEBUG: Using endpoint: ${favoritesEndpoint}`);
            
            // Загружаем избранные объекты
            const response = await fetch(favoritesEndpoint);
            
            // ✅ ИСПРАВЛЕНИЕ: Проверяем статус ответа перед парсингом JSON
            if (!response.ok) {
                console.warn(`⚠️ API ${favoritesEndpoint} returned ${response.status}. User likely not authenticated.`);
                // Если пользователь не авторизован, используем пустой список
                this.favorites = [];
                this.favoriteComplexes = [];
                return false;
            }
            
            const result = await response.json();
            
            console.log('🔥 Favorites API response:', result);
            
            if (result.success && result.favorites) {
                // Extract property IDs from API response  
                this.favorites = result.favorites.map(fav => fav.id.toString());
                console.log('🔥 Loaded favorites from API:', this.favorites);
            }
            
            // Загружаем избранные ЖК
            const complexResponse = await fetch(complexesEndpoint, {
                credentials: 'same-origin'
            });
            
            // ✅ ИСПРАВЛЕНИЕ: Проверяем статус ответа перед парсингом JSON
            if (!complexResponse.ok) {
                console.warn(`⚠️ API ${complexesEndpoint} returned ${complexResponse.status}. User likely not authenticated.`);
                this.favoriteComplexes = [];
                return false;
            }
            
            const complexResult = await complexResponse.json();
            
            console.log('🔥 Complex favorites API response:', complexResult);
            
            if (complexResult.success && complexResult.complexes) {
                // Extract complex IDs from API response
                this.favoriteComplexes = complexResult.complexes.map(fav => fav.id.toString());
                console.log('🔥 Loaded complex favorites from API:', this.favoriteComplexes);
            }
            
            // Trigger UI update immediately after loading
            this.updateFavoritesUI();
            this.updateComplexFavoritesUI();
            console.log('🔥 UI update called after API load');
            
            return true;
        } catch (error) {
            console.error('Error loading favorites from API:', error);
            return false;
        }
    }

    saveFavorites() {
        // Только для обычных пользователей
        if (!this.isManager()) {
            try {
                localStorage.setItem('inback_favorites', JSON.stringify(this.favorites));
            } catch (error) {
                console.error('Error saving favorites:', error);
            }
        }
    }

    getFavorites() {
        return [...this.favorites];
    }

    isFavorited(propertyId) {
        return this.favorites.includes(String(propertyId));
    }

    clearAllFavorites() {
        this.favorites = [];
        this.saveFavorites();
        this.updateFavoritesUI();
        this.updateFavoritesCounter();
        this.showNotification('Все избранные удалены', 'info');
    }

    showAuthRequiredMessage(action) {
        console.log(`⚠️ User not authenticated for action: ${action}`);
        
        // Show alert on mobile/desktop
        alert(`Чтобы добавлять в ${action}, необходимо зарегистрироваться`);
        
        // Open registration modal or redirect
        setTimeout(() => {
            if (typeof openApplicationModal === 'function') {
                openApplicationModal();
            } else {
                window.location.href = '/register';
            }
        }, 100);
    }

    // Complex favorites methods
    async toggleComplexFavorite(complexId, heartElement) {
        // Check if user is authenticated
        const userAuthElement = document.querySelector('a[href*="dashboard"]') || document.querySelector('.user-authenticated');
        const isAuthenticated = userAuthElement !== null || document.querySelector('a[href*="logout"]') !== null;
        
        if (!isAuthenticated) {
            this.showAuthRequiredMessage('избранное');
            return;
        }
        
        // Check if complex is in favorites (handle both object and primitive formats)
        const isComplexFavorited = this.favoriteComplexes.some(item => 
            (typeof item === 'object' ? item.id : item) === complexId
        );
        
        if (!isComplexFavorited) {
            await this.addComplexToFavorites(complexId, heartElement);
        } else {
            await this.removeComplexFromFavorites(complexId, heartElement);
        }
        
        // Для менеджеров - перезагрузить из API для синхронизации
        if (this.isManager()) {
            await this.loadFavoritesFromAPI();
        }
        
        this.updateComplexFavoritesUI();
        // Update counter after async operations complete
        await this.updateFavoritesCounter();
    }

    async addComplexToFavorites(complexId, heartElement) {
        if (!this.favoriteComplexes.some(item => (typeof item === 'object' ? item.id : item) === complexId)) {
            try {
                // Check if user is a manager and use appropriate endpoint
                const endpoint = this.isManager() ? '/api/manager/complexes/favorites/toggle' : '/api/complexes/favorites/toggle';
                
                // Add to API first
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': this.getCSRFToken()
                    },
                    body: JSON.stringify({
                        complex_id: complexId,
                        complex_name: 'ЖК',
                        action: 'add'
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    // Для менеджеров - перезагрузить из API, для пользователей - обновить localStorage
                    if (this.isManager()) {
                        await this.loadFavoritesFromAPI();
                    } else {
                        // Update local storage for regular users
                        this.favoriteComplexes.push({
                            id: complexId,
                            addedAt: new Date().toLocaleString('ru-RU')
                        });
                        this.saveFavoriteComplexes();
                    }
                    
                    // Animate heart
                    heartElement.classList.add('favorited', 'animate-pulse');
                    this.createFloatingHearts(heartElement);
                    
                    // Remove pulse after animation
                    setTimeout(() => {
                        heartElement.classList.remove('animate-pulse');
                    }, 600);
                    
                    this.showNotification(`ЖК добавлен в избранное`, 'success');
                    return true;
                } else {
                    console.error('Failed to add complex to favorites:', result.error);
                    this.showNotification('Ошибка при добавлении в избранное', 'error');
                    return false;
                }
            } catch (error) {
                console.error('Error adding complex to favorites:', error);
                // Fallback to localStorage only
                this.favoriteComplexes.push({
                    id: complexId,
                    addedAt: new Date().toLocaleString('ru-RU')
                });
                this.saveFavoriteComplexes();
                this.showNotification(`ЖК добавлен в избранное (локально)`, 'success');
                return false;
            }
        }
        return false;
    }

    async removeComplexFromFavorites(complexId, heartElement) {
        try {
            // Check if user is a manager and use appropriate endpoint
            const endpoint = this.isManager() ? `/api/manager/complexes/favorites/${complexId}` : `/api/complexes/favorites/${complexId}`;
            
            // Remove from API first
            const response = await fetch(endpoint, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCSRFToken()
                }
            });

            const result = await response.json();
            
            if (result.success) {
                // Для менеджеров - перезагрузить из API, для пользователей - обновить localStorage
                if (this.isManager()) {
                    await this.loadFavoritesFromAPI();
                } else {
                    // Update local storage for regular users
                    this.favoriteComplexes = this.favoriteComplexes.filter(item => (typeof item === 'object' ? item.id : item) !== complexId);
                    this.saveFavoriteComplexes();
                }
                
                // Animate removal
                heartElement.classList.remove('favorited');
                heartElement.classList.add('animate-click');
                
                setTimeout(() => {
                    heartElement.classList.remove('animate-click');
                }, 300);
                
                this.showNotification(`ЖК удален из избранного`, 'info');
                return true;
            } else {
                console.error('Failed to remove complex from favorites:', result.error);
                this.showNotification('Ошибка при удалении из избранного', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error removing complex from favorites:', error);
            // Fallback to localStorage only
            this.favoriteComplexes = this.favoriteComplexes.filter(item => (typeof item === 'object' ? item.id : item) !== complexId);
            this.saveFavoriteComplexes();
            this.showNotification(`ЖК удален из избранного (локально)`, 'info');
            return false;
        }
    }

    updateComplexFavoritesUI() {
        const hearts = document.querySelectorAll('.favorite-heart[data-complex-id]');
        console.log(`🔄 updateComplexFavoritesUI: Found ${hearts.length} complex hearts, favorites:`, this.favoriteComplexes);
        
        hearts.forEach(heart => {
            const complexId = heart.dataset.complexId || heart.getAttribute('data-complex-id');
            const complexIdStr = String(complexId);
            const isFavorited = this.favoriteComplexes.some(item => String(typeof item === 'object' ? item.id : item) === complexIdStr);
            
            console.log(`  Heart ${complexIdStr}: ${isFavorited ? '❤️ FAVORITED' : '🤍 not favorited'}`);
            
            if (isFavorited) {
                heart.classList.add('favorited');
                heart.title = 'Удалить из избранного';
                // Also update the icon inside
                const icon = heart.querySelector('i');
                if (icon) {
                    icon.classList.remove('text-gray-400');
                    icon.classList.add('text-red-500');
                }
            } else {
                heart.classList.remove('favorited');
                heart.title = 'Добавить в избранное';
                // Also update the icon inside
                const icon = heart.querySelector('i');
                if (icon) {
                    icon.classList.remove('text-red-500');
                    icon.classList.add('text-gray-400');
                }
            }
        });
    }

    updateComplexFavoritesCounter() {
        // Use the main updateFavoritesCounter which gets data from API
        // This ensures consistent count across properties and complexes
        this.updateFavoritesCounter();
    }

    loadFavoriteComplexes() {
        try {
            const stored = localStorage.getItem('inback_favorite_complexes');
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error loading favorite complexes:', error);
            return [];
        }
    }

    saveFavoriteComplexes() {
        // Только для обычных пользователей
        if (!this.isManager()) {
            try {
                localStorage.setItem('inback_favorite_complexes', JSON.stringify(this.favoriteComplexes));
            } catch (error) {
                console.error('Error saving favorite complexes:', error);
            }
        }
    }

    getFavoriteComplexes() {
        return [...this.favoriteComplexes];
    }

    isComplexFavorited(complexId) {
        return this.favoriteComplexes.includes(complexId);
    }
}

// Initialize favorites manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // ✅ ИСПРАВЛЕНО: Не инициализируем на страницах менеджера
    const isManagerPage = window.location.pathname.startsWith('/manager/');
    
    if (isManagerPage) {
        console.log('🔧 Skipping FavoritesManager initialization on manager page');
        return;
    }
    
    // ✅ ИСПРАВЛЕНО: Предотвращаем дублирование с base.html
    if (!window.favoritesManager && typeof FavoritesManager !== 'undefined') {
        window.favoritesManager = new FavoritesManager();
        console.log('🔧 FavoritesManager initialized from favorites.js');
    } else {
        console.log('🔧 FavoritesManager already exists, skipping initialization');
    }
});

// Helper function to create favorite heart HTML
function createFavoriteHeart(propertyId, classes = '') {
    return `
        <div class="favorite-heart ${classes}" data-property-id="${propertyId}" title="Добавить в избранное">
            <i class="fas fa-heart"></i>
        </div>
    `;
}

// Helper function to create favorite heart HTML for complexes
function createComplexFavoriteHeart(complexId, classes = '') {
    return `
        <div class="favorite-heart ${classes}" data-complex-id="${complexId}" title="Добавить ЖК в избранное">
            <i class="fas fa-heart"></i>
        </div>
    `;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FavoritesManager, createFavoriteHeart };
}