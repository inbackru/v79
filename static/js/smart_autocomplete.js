/**
 * Профессиональная система автокомплита для поиска недвижимости
 * Основана на лучших UX практиках ведущих сервисов
 */

class SmartAutocomplete {
    constructor(inputElement, options = {}) {
        this.input = inputElement;
        this.options = {
            minChars: 1,
            debounceMs: 200,
            maxSuggestions: 8,
            apiUrl: '/api/search/suggestions',
            onSelect: null,
            onSearch: null,
            placeholder: 'Поиск по адресу, ЖК, застройщику...',
            ...options
        };
        
        this.suggestions = [];
        this.selectedIndex = -1;
        this.isVisible = false;
        this.cache = new Map();
        this.debounceTimer = null;
        
        this.init();
    }
    
    init() {
        this.createSuggestionsContainer();
        this.bindEvents();
        this.input.setAttribute('placeholder', this.options.placeholder);
        this.input.setAttribute('autocomplete', 'off');
        this.input.setAttribute('spellcheck', 'false');
    }
    
    createSuggestionsContainer() {
        this.container = document.createElement('div');
        this.container.className = 'smart-autocomplete-container';
        this.container.innerHTML = `
            <div class="smart-autocomplete-suggestions" id="${this.input.id}_suggestions">
                <!-- Подсказки будут добавлены динамически -->
            </div>
        `;
        
        // Позиционируем относительно input
        this.input.parentNode.appendChild(this.container);
        this.suggestionsElement = this.container.querySelector('.smart-autocomplete-suggestions');
    }
    
    bindEvents() {
        // Ввод текста
        this.input.addEventListener('input', (e) => {
            this.handleInput(e.target.value);
        });
        
        // Фокус - показываем популярные запросы
        this.input.addEventListener('focus', () => {
            if (!this.input.value.trim()) {
                this.showPopularSuggestions();
            }
        });
        
        // Потеря фокуса - скрываем подсказки
        this.input.addEventListener('blur', (e) => {
            // Небольшая задержка для обработки клика по подсказке
            setTimeout(() => {
                if (!this.container.contains(document.activeElement)) {
                    this.hideSuggestions();
                }
            }, 150);
        });
        
        // Навигация клавиатурой
        this.input.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });
        
        // Клики по подсказкам
        this.container.addEventListener('click', (e) => {
            console.log('🔥 Container clicked!', e.target);
            const suggestionElement = e.target.closest('.suggestion-item');
            console.log('🔥 Suggestion element:', suggestionElement);
            if (suggestionElement) {
                const index = Array.from(this.suggestionsElement.children).indexOf(suggestionElement);
                console.log('🔥 Calling selectSuggestion with index:', index);
                this.selectSuggestion(index);
            }
        });
        
        // Клики вне элемента
        document.addEventListener('click', (e) => {
            if (!this.input.contains(e.target) && !this.container.contains(e.target)) {
                this.hideSuggestions();
            }
        });
    }
    
    handleInput(value) {
        const query = value.trim();
        
        // Очищаем предыдущий таймер
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        if (query.length < this.options.minChars) {
            this.hideSuggestions();
            return;
        }
        
        // Debounce для оптимизации
        this.debounceTimer = setTimeout(() => {
            this.searchSuggestions(query);
        }, this.options.debounceMs);
    }
    
    async searchSuggestions(query) {
        // Проверяем кэш
        if (this.cache.has(query)) {
            this.displaySuggestions(this.cache.get(query));
            return;
        }
        
        try {
            this.showLoading();
            
            const response = await fetch(`${this.options.apiUrl}?q=${encodeURIComponent(query)}`);
            const suggestions = await response.json();
            
            // Кэшируем результат
            this.cache.set(query, suggestions);
            
            // Ограничиваем размер кэша
            if (this.cache.size > 50) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            
            this.displaySuggestions(suggestions);
            
        } catch (error) {
            console.error('Ошибка поиска подсказок:', error);
            this.hideSuggestions();
        }
    }
    
    showPopularSuggestions() {
        // Показываем популярные запросы при фокусе
        const popularQueries = [
            { text: 'Студии', type: 'rooms', subtitle: 'Все студии в городе', icon: 'fas fa-home' },
            { text: '1-комнатные', type: 'rooms', subtitle: 'Однокомнатные квартиры', icon: 'fas fa-home' },
            { text: '2-комнатные', type: 'rooms', subtitle: 'Двухкомнатные квартиры', icon: 'fas fa-home' },
            { text: 'Новостройки', type: 'category', subtitle: 'Квартиры в новых домах', icon: 'fas fa-building' }
        ];
        
        this.displaySuggestions(popularQueries);
    }
    
    displaySuggestions(suggestions) {
        this.suggestions = suggestions;
        this.selectedIndex = -1;
        
        if (!suggestions || suggestions.length === 0) {
            this.showNoResults();
            return;
        }
        
        const html = suggestions.map((suggestion, index) => `
            <div class="suggestion-item ${index === this.selectedIndex ? 'selected' : ''}" data-index="${index}">
                <div class="suggestion-icon">
                    <i class="${suggestion.icon || 'fas fa-search'}"></i>
                </div>
                <div class="suggestion-content">
                    <div class="suggestion-text">${this.highlightMatch(suggestion.text)}</div>
                    ${suggestion.subtitle ? `<div class="suggestion-subtitle">${suggestion.subtitle}</div>` : ''}
                </div>
                <div class="suggestion-type">
                    ${this.getTypeLabel(suggestion.type)}
                </div>
            </div>
        `).join('');
        
        this.suggestionsElement.innerHTML = html;
        this.showSuggestions();
    }
    
    highlightMatch(text) {
        const query = this.input.value.trim();
        if (!query) return text;
        
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }
    
    getTypeLabel(type) {
        const labels = {
            'address': 'Адрес',
            'complex': 'ЖК',
            'developer': 'Застройщик',
            'district': 'Район',
            'rooms': 'Тип',
            'category': 'Категория'
        };
        return labels[type] || '';
    }
    
    showLoading() {
        this.suggestionsElement.innerHTML = `
            <div class="suggestion-loading">
                <div class="loading-spinner"></div>
                <span>Поиск...</span>
            </div>
        `;
        this.showSuggestions();
    }
    
    showNoResults() {
        this.suggestionsElement.innerHTML = `
            <div class="suggestion-no-results">
                <i class="fas fa-search-minus"></i>
                <span>Ничего не найдено</span>
            </div>
        `;
        this.showSuggestions();
    }
    
    showSuggestions() {
        this.container.classList.add('visible');
        this.isVisible = true;
    }
    
    hideSuggestions() {
        this.container.classList.remove('visible');
        this.isVisible = false;
        this.selectedIndex = -1;
    }
    
    handleKeydown(e) {
        if (!this.isVisible) return;
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
                this.updateSelection();
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
                this.updateSelection();
                break;
                
            case 'Enter':
                e.preventDefault();
                if (this.selectedIndex >= 0) {
                    this.selectSuggestion(this.selectedIndex);
                } else {
                    this.performSearch();
                }
                break;
                
            case 'Escape':
                e.preventDefault();
                this.hideSuggestions();
                this.input.blur();
                break;
        }
    }
    
    updateSelection() {
        const items = this.suggestionsElement.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedIndex);
        });
        
        // Прокрутка к выбранному элементу
        if (this.selectedIndex >= 0) {
            const selectedItem = items[this.selectedIndex];
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: 'nearest' });
            }
        }
    }
    
    selectSuggestion(index) {
        console.log('🔥 selectSuggestion called, index:', index, 'total suggestions:', this.suggestions.length);
        if (index >= 0 && index < this.suggestions.length) {
            const suggestion = this.suggestions[index];
            console.log('🔥 Selected suggestion:', suggestion);
            
            // ✅ ИСПРАВЛЕНИЕ: Если есть URL в suggestion, переходим по нему
            if (suggestion.url) {
                console.log('🔥 Navigating to URL:', suggestion.url);
                window.location.href = suggestion.url;
                return;
            }
            
            this.input.value = suggestion.text;
            this.hideSuggestions();
            
            if (this.options.onSelect) {
                console.log('🔥 Calling onSelect callback');
                this.options.onSelect(suggestion);
            } else {
                console.log('🔥 No onSelect, calling performSearch');
                this.performSearch(suggestion);
            }
        }
    }
    
    performSearch(suggestion = null) {
        const query = this.input.value.trim();
        if (query && this.options.onSearch) {
            this.options.onSearch(query, suggestion);
        }
    }
    
    // Публичные методы
    clear() {
        this.input.value = '';
        this.hideSuggestions();
    }
    
    destroy() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.container.remove();
        this.cache.clear();
    }
}

// CSS стили для автокомплита
const autocompleteStyles = `
    .smart-autocomplete-container {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 999999;
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.2s ease;
        pointer-events: none;
    }
    
    .smart-autocomplete-container.visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
    }
    
    .smart-autocomplete-suggestions {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        margin-top: 4px;
        max-height: 320px;
        overflow-y: auto;
    }
    
    .suggestion-item {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        cursor: pointer;
        border-bottom: 1px solid #f3f4f6;
        transition: background-color 0.15s ease;
    }
    
    .suggestion-item:last-child {
        border-bottom: none;
    }
    
    .suggestion-item:hover,
    .suggestion-item.selected {
        background-color: #f8fafc;
    }
    
    .suggestion-icon {
        width: 20px;
        height: 20px;
        margin-right: 12px;
        color: #0088cc;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .suggestion-content {
        flex: 1;
        min-width: 0;
    }
    
    .suggestion-text {
        font-size: 14px;
        font-weight: 500;
        color: #1f2937;
        margin-bottom: 2px;
    }
    
    .suggestion-text mark {
        background-color: #fef3c7;
        color: #d97706;
        padding: 0;
    }
    
    .suggestion-subtitle {
        font-size: 12px;
        color: #6b7280;
    }
    
    .suggestion-type {
        font-size: 11px;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    .suggestion-loading,
    .suggestion-no-results {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: #6b7280;
        font-size: 14px;
    }
    
    .loading-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #e5e7eb;
        border-top: 2px solid #0088cc;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-right: 8px;
    }
    
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    /* Адаптация для мобильных */
    @media (max-width: 768px) {
        .smart-autocomplete-suggestions {
            max-height: 280px;
        }
        
        .suggestion-item {
            padding: 14px 16px;
        }
        
        .suggestion-text {
            font-size: 15px;
        }
    }
`;

// Добавляем стили на страницу
if (!document.querySelector('#smart-autocomplete-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'smart-autocomplete-styles';
    styleElement.textContent = autocompleteStyles;
    document.head.appendChild(styleElement);
}

// Экспортируем класс
window.SmartAutocomplete = SmartAutocomplete;