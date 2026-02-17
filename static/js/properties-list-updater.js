// ✅ PROPERTIES LIST DYNAMIC UPDATER - VERSION 1761859200
console.log('📋 PROPERTIES-LIST-UPDATER.JS LOADED');

// Функция для обновления списка объектов
window.updatePropertiesList = function(properties) {
    console.log('🔄 updatePropertiesList called with', properties.length, 'properties');
    
    const container = document.getElementById('properties-container');
    if (!container) {
        console.error('❌ properties-container not found!');
        return;
    }
    
    // Очищаем контейнер (только для AJAX обновлений)
    console.log('🔄 Clearing container for AJAX update');
    container.innerHTML = '';
    
    // Рендерим каждую карточку
    properties.forEach((property, index) => {
        const card = renderPropertyCard(property, index);
        container.appendChild(card);
    });
    
    // Переинициализируем функционал карточек (избранное, сравнение, клики)
    if (typeof window.FavoritesManager !== 'undefined' && window.FavoritesManager.initializeHeartButtons) {
        console.log('🔄 Reinitializing FavoritesManager...');
        window.FavoritesManager.initializeHeartButtons();
    }
    
    if (typeof window.initializeComparisonButtons === 'function') {
        console.log('🔄 Reinitializing comparison buttons...');
        window.initializeComparisonButtons();
    }
    
    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Реинициализация image carousel после AJAX обновления
    if (typeof window.initializeImageCarousels === 'function') {
        console.log('🔄 Reinitializing image carousels...');
        window.initializeImageCarousels();
    } else {
        console.warn('⚠️ window.initializeImageCarousels not found');
    }
    
    // PDF кнопки и Presentation модал работают через onclick атрибуты - не требуют реинициализации
    // Клики на карточки уже добавлены в renderPropertyCard() выше
    
    // ✅ ИСПРАВЛЕНИЕ: Применяем текущий режим отображения (list/grid)
    if (typeof window.currentViewMode !== 'undefined') {
        if (window.currentViewMode === 'list' && typeof window.switchToListView === 'function') {
            console.log('🔄 Applying LIST view after AJAX update');
            window.switchToListView();
        } else if (window.currentViewMode === 'grid' && typeof window.switchToGridView === 'function') {
            console.log('🔄 Applying GRID view after AJAX update');
            window.switchToGridView();
        }
    }
    
    console.log('✅ List updated with', properties.length, 'properties');
};

// Функция для рендеринга одной карточки объекта - ПОЛНОСТЬЮ ИДЕНТИЧНА templates/properties.html
function renderPropertyCard(property, index) {
    const card = document.createElement('div');
    card.className = 'property-card bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden w-full cursor-pointer';
    
    // Все data-атрибуты ИДЕНТИЧНО оригиналу
    card.setAttribute('data-property-url', `/object/${property.id}`);
    card.setAttribute('data-type', property.type || 'apartment');
    card.setAttribute('data-rooms', property.rooms || 0);
    card.setAttribute('data-price', property.price || 0);
    card.setAttribute('data-district', property.district || '');
    card.setAttribute('data-developer', property.developer || '');
    card.setAttribute('data-complex', property.residential_complex || property.complex_name || 'Не указан');
    card.setAttribute('data-property-type', property.property_type || property.type || 'apartment');
    card.setAttribute('data-completion', property.completion_date || '2024');
    card.setAttribute('data-area', property.area || 0);
    card.setAttribute('data-floor', property.floor || 0);
    card.setAttribute('data-mortgage', property.mortgage_available !== undefined ? property.mortgage_available : 'true');
    card.setAttribute('data-installment', property.installment_available !== undefined ? property.installment_available : 'false');
    card.setAttribute('data-maternal-capital', property.maternal_capital !== undefined ? property.maternal_capital : 'false');
    card.setAttribute('data-trade-in', property.trade_in !== undefined ? property.trade_in : 'false');
    card.setAttribute('data-cashback', property.cashback_available !== undefined ? property.cashback_available : 'true');
    
    // Подготовка данных для галереи (максимум 4 изображения)
    const gallery = property.gallery && property.gallery.length > 0 ? property.gallery.slice(0, 4) : [property.image || 'https://via.placeholder.com/320x280/f3f4f6/9ca3af?text=Фото+недоступно'];
    const hasMultipleImages = gallery.length > 1;
    
    // Формируем описание комнат
    const roomDescription = property.rooms == 0 ? 'Студия' : `${property.rooms}-комн`;
    
    // Генерация HTML слайдов для карусели
    const carouselSlidesHTML = gallery.map((image, idx) => `
        <div class="carousel-slide absolute inset-0 ${idx > 0 ? 'opacity-0' : ''} transition-opacity duration-300" data-slide="${idx}">
            <img src="${escapeHtml(image)}" 
                 alt="${roomDescription} ${property.area} м² - фото ${idx + 1}" 
                 class="w-full h-full object-cover" 
                 loading="lazy">
        </div>
    `).join('');
    
    // Генерация dots для индикатора
    const dotsHTML = hasMultipleImages ? `
        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            ${gallery.map((_, idx) => `
                <button onclick="event.stopPropagation(); event.preventDefault(); goToImageSlide(this, ${idx}, event); return false;" 
                        class="slider-dot-btn w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-white/80' : 'bg-white/50'} hover:bg-white transition-colors" 
                        data-slide="${idx}"></button>
            `).join('')}
        </div>
    ` : '';
    
    // Navigation arrows (только если есть несколько изображений)
    const navigationHTML = hasMultipleImages ? `
        <button onclick="event.stopPropagation(); event.preventDefault(); prevImageSlide(this, event); return false;" 
                class="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 slider-prev-btn">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
        </button>
        <button onclick="event.stopPropagation(); event.preventDefault(); nextImageSlide(this, event); return false;" 
                class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10 slider-next-btn">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
        </button>
    ` : '';
    
    // Определяем, является ли пользователь менеджером
    const isManager = Boolean(window.manager_authenticated);
    
    // Формируем цену и ипотеку
    const priceHTML = property.price && property.price > 0 ? `
        <div class="text-2xl font-bold text-gray-900">
            ${formatNumber(property.price)} ₽
        </div>
        <div class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
            от ${formatNumber(Math.floor((property.price * 0.05) / 12))} ₽/мес ипотека
        </div>
    ` : `
        <div class="text-2xl font-bold text-gray-900">
            Цена по запросу
        </div>
    `;
    
    // Кнопка презентации (только для менеджеров)
    const presentationButtonHTML = isManager ? `
        <button class="presentation-btn w-10 h-10 bg-white border border-purple-300 rounded flex items-center justify-center text-purple-600 hover:bg-purple-50 hover:border-purple-400 hover:text-purple-700 hover:scale-105 transition-all duration-200" 
                data-property-id="${property.id}" 
                title="Добавить в презентацию" 
                onclick="window.openPresentationModal('${property.id}'); event.stopPropagation();">
            <i class="fas fa-plus"></i>
        </button>
    ` : '';
    
    // Формируем HTML карточки - ТОЧНАЯ КОПИЯ templates/properties.html
    card.innerHTML = `
        <!-- Image Section with Slider -->
        <div class="relative w-80 h-60 flex-shrink-0 group">
            <div class="carousel-container w-full h-60 relative overflow-hidden bg-gray-100 rounded-lg" data-property-id="${property.id}">
                <!-- Image slides -->
                ${carouselSlidesHTML}
                
                <!-- Navigation arrows -->
                ${navigationHTML}
                
                <!-- Dots indicator -->
                ${dotsHTML}
            </div>
            
            <!-- Blue Cashback Badge -->
            <div class="absolute top-3 left-3 bg-blue-600 text-white text-xs font-medium px-2 py-1 rounded z-20">
                Кэшбек до ${formatNumber(property.cashback || 0)} ₽
            </div>
            
            <!-- Favorite Icons Container -->
            <div class="absolute top-3 right-3 flex gap-2 z-20">
                <!-- Universal Heart Icon -->
                <div class="w-8 h-8 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow cursor-pointer favorite-heart z-20" 
                     data-property-id="${property.id}" 
                     title="Добавить в избранное" 
                     onclick="if(window.favoritesManager) { window.favoritesManager.toggleFavorite('${property.id}', this); event.stopPropagation(); }">
                    <i class="fas fa-heart text-gray-400 hover:text-red-500 text-sm transition-colors"></i>
                </div>
            </div>
        </div>
        
        <!-- Content Section -->
        <div class="flex-1 p-6 flex flex-col">
            <!-- Title -->
            <h2 class="text-xl font-semibold text-gray-900 mb-3">
                ${roomDescription}, ${property.area} м², ${property.floor}/${property.total_floors} эт.
            </h2>
            
            <!-- Complex and Location -->
            <div class="mb-2">
                ${property.residential_complex || property.complex_name ? `
                    <a href="/residential-complex/${escapeHtml(property.residential_complex || property.complex_name)}" 
                       class="text-blue-600 hover:text-blue-700 hover:underline text-sm font-medium" 
                       onclick="event.stopPropagation();">
                        ${escapeHtml(property.residential_complex || property.complex_name)}
                    </a>
                ` : `
                    <span class="text-gray-700 text-sm font-medium">
                        ЖК не указан
                    </span>
                `}
                <span class="text-blue-600 text-sm"> • Краснодарский край</span>
            </div>
            
            <!-- Address -->
            <div class="text-gray-500 text-sm mb-2">
                ${escapeHtml(property.address || 'Россия, Краснодарский край, Сочи, Кудепста м-н, Искра, 88 лит7')}
            </div>
            
            <!-- Developer -->
            <div class="text-gray-700 text-sm mb-4">
                <span class="font-medium">Застройщик:</span> ${escapeHtml(property.developer || property.developer_name || 'ГК Неометрия')}
            </div>
            
            <!-- Tags -->
            <div class="flex gap-2 mb-4">
                <span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">${property.floor}-й этаж</span>
                <span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">${escapeHtml(property.renovation_display_name || 'Без отделки')}</span>
                <span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">${escapeHtml(property.complex_object_class_display_name || 'Комфорт')}</span>
            </div>
            
            <div class="flex-1"></div>
            
            <!-- Action Buttons Row with Price and Mortgage Info -->
            <div class="flex items-center justify-between">
                <div class="flex flex-col gap-2">
                    ${priceHTML}
                </div>
                <div class="flex gap-2">
                    <a href="/object/${property.id}/pdf" target="_blank" 
                       class="w-10 h-10 bg-white border border-gray-300 rounded flex items-center justify-center text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 hover:scale-105 transition-all duration-200" 
                       title="Скачать PDF" 
                       onclick="event.stopPropagation();">
                        <i class="fas fa-file-pdf"></i>
                    </a>
                    <button class="compare-btn w-10 h-10 bg-white border border-gray-300 rounded flex items-center justify-center text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 hover:scale-105 transition-all duration-200" 
                            data-property-id="${property.id}" 
                            title="Добавить к сравнению">
                        <i class="fas fa-balance-scale"></i>
                    </button>
                    ${presentationButtonHTML}
                </div>
            </div>
        </div>
    `;
    
    // Добавляем обработчик клика на карточку
    card.addEventListener('click', function(e) {
        // Игнорируем клики на кнопки и ссылки
        if (e.target.closest('button') || e.target.closest('a')) return;
        window.location.href = `/object/${property.id}`;
    });
    
    return card;
}

// Вспомогательная функция для экранирования HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Функция для обновления пагинации
window.updatePagination = function(pagination) {
    console.log('📄 updatePagination called:', pagination);
    
    // Обновляем счетчик "Найдено X объектов"
    const resultsCount = document.getElementById('results-count');
    if (resultsCount) {
        resultsCount.textContent = pagination.total;
        console.log('✅ Updated results-count to', pagination.total);
    }
    
    // Обновляем счетчик resultsCounter (статичный счётчик в filter chips)
    const resultsCounter = document.getElementById('resultsCounter');
    if (resultsCounter) {
        // Функция склонения слова "объект"
        const getObjectWord = (count) => {
            if (count % 100 >= 11 && count % 100 <= 14) return "объектов";
            switch (count % 10) {
                case 1: return "объект";
                case 2: case 3: case 4: return "объекта";
                default: return "объектов";
            }
        };
        resultsCounter.textContent = `${pagination.total} ${getObjectWord(pagination.total)}`;
        console.log('✅ Updated resultsCounter to', pagination.total);
    }
    
    // Обновляем счетчик на кнопке "Показать на карте" (если есть)
    const counters = document.querySelectorAll('.properties-count');
    counters.forEach(counter => {
        counter.textContent = pagination.total;
    });
    
    // Обновляем пагинацию
    const paginationContainer = document.querySelector('.pagination');
    if (!paginationContainer) {
        console.warn('⚠️ Pagination container not found');
        return;
    }
    
    if (pagination.total_pages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    let html = '<div class="flex justify-center items-center gap-2 mt-8">';
    
    // Previous button
    if (pagination.has_prev) {
        html += `<a href="?page=${pagination.page - 1}" class="pagination-link px-4 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50" data-page="${pagination.page - 1}">Назад</a>`;
    }
    
    // Page numbers
    const maxPages = 7;
    let startPage = Math.max(1, pagination.page - Math.floor(maxPages / 2));
    let endPage = Math.min(pagination.total_pages, startPage + maxPages - 1);
    
    if (endPage - startPage < maxPages - 1) {
        startPage = Math.max(1, endPage - maxPages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        if (i === pagination.page) {
            html += `<span class="px-4 py-2 rounded bg-blue-600 text-white font-semibold">${i}</span>`;
        } else {
            html += `<a href="?page=${i}" class="pagination-link px-4 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50" data-page="${i}">${i}</a>`;
        }
    }
    
    // Next button
    if (pagination.has_next) {
        html += `<a href="?page=${pagination.page + 1}" class="pagination-link px-4 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50" data-page="${pagination.page + 1}">Вперёд</a>`;
    }
    
    html += '</div>';
    paginationContainer.innerHTML = html;
    
    // Добавляем обработчики клика на ссылки пагинации
    attachPaginationHandlers();
    
    console.log('✅ Pagination updated');
};

// Функция для прикрепления обработчиков к ссылкам пагинации
function attachPaginationHandlers() {
    const links = document.querySelectorAll('.pagination-link');
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            loadPage(page);
        });
    });
}

// Функция для загрузки конкретной страницы
function loadPage(page) {
    console.log('📄 Loading page:', page);
    
    showLoadingIndicator();
    
    const currentUrl = new URLSearchParams(window.location.search);
    currentUrl.set('page', page);
    if (window.currentCityId && !currentUrl.has('city_id')) {
        currentUrl.set('city_id', window.currentCityId);
    }
    
    const apiUrl = '/api/properties/list?' + currentUrl.toString();
    
    fetch(apiUrl)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.properties) {
                updatePropertiesList(data.properties);
                updatePagination(data.pagination);
                
                const newUrl = window.location.pathname + '?' + currentUrl.toString();
                window.history.pushState({}, '', newUrl);
                
                scrollToPropertiesList();
            }
            hideLoadingIndicator();
        })
        .catch(error => {
            console.error('❌ Error loading page:', error);
            hideLoadingIndicator();
        });
}

// Вспомогательная функция для форматирования чисел
function formatNumber(num) {
    if (!num) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Вспомогательные функции для индикатора загрузки и скролла
// (определены в properties-sorting.js, но добавляем проверку на существование)
function showLoadingIndicator() {
    if (typeof window.showLoadingIndicator === 'undefined') {
        const container = document.getElementById('properties-container');
        if (container) {
            container.style.opacity = '0.5';
            container.style.pointerEvents = 'none';
        }
    }
}

function hideLoadingIndicator() {
    if (typeof window.hideLoadingIndicator === 'undefined') {
        const container = document.getElementById('properties-container');
        if (container) {
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }
    }
}

function scrollToPropertiesList() {
    const container = document.getElementById('properties-container');
    if (container) {
        const offset = 100;
        const top = container.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
    }
}

// Функция для переинициализации функционала карточек без изменения DOM
function reinitializeCardFeatures() {
    console.log('🔄 Reinitializing card features without DOM changes');
    
    // Переинициализируем функционал карточек (избранное, сравнение, клики)
    if (typeof window.FavoritesManager !== 'undefined' && window.FavoritesManager.initializeHeartButtons) {
        console.log('🔄 Reinitializing FavoritesManager...');
        window.FavoritesManager.initializeHeartButtons();
    }
    
    if (typeof window.initializeComparisonButtons === 'function') {
        console.log('🔄 Reinitializing comparison buttons...');
        window.initializeComparisonButtons();
    }
    
    // Инициализация image carousel для SSR карточек
    if (typeof window.initializeImageCarousels === 'function') {
        console.log('🔄 Initializing image carousels for SSR cards...');
        window.initializeImageCarousels();
    }
    
    console.log('✅ Card features reinitialized');
}

// Export renderPropertyCard for use in infinite-scroll.js
window.renderPropertyCard = renderPropertyCard;

console.log('✅ properties-list-updater.js loaded');
