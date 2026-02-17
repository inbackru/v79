// 🔍 HERO AUTOCOMPLETE - Немедленная инициализация для главной страницы
console.log('🔍 hero-autocomplete.js загружается...');

(function initHeroAutocomplete() {
    let searchTimeout;
    let suggestionsContainer;
    let heroSearchInput;
    
    // Функция инициализации с повторными попытками
    function tryInit() {
        heroSearchInput = document.getElementById('hero-search');
        
        if (!heroSearchInput) {
            console.warn('⚠️ hero-search не найден, попытка через 50ms...');
            setTimeout(tryInit, 50);
            return;
        }
        
        console.log('✅ hero-search найден, инициализация автокомплита...');
        
        // Создаем контейнер для подсказок если его нет
        suggestionsContainer = document.getElementById('hero-search-suggestions');
        if (!suggestionsContainer) {
            suggestionsContainer = document.createElement('div');
            suggestionsContainer.id = 'hero-search-suggestions';
            suggestionsContainer.className = 'absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 max-h-96 overflow-y-auto z-50 hidden';
            
            // Вставляем после родителя поля поиска
            const searchContainer = heroSearchInput.parentElement;
            if (searchContainer) {
                searchContainer.style.position = 'relative';
                searchContainer.appendChild(suggestionsContainer);
            }
        }
        
        // Обработчик ввода текста
        heroSearchInput.addEventListener('input', function(e) {
            clearTimeout(searchTimeout);
            const query = this.value.trim();
            
            if (query.length < 2) {
                hideSuggestions();
                return;
            }
            
            // Debounce для снижения нагрузки
            searchTimeout = setTimeout(() => {
                fetchSuggestions(query);
            }, 300);
        });
        
        // Скрываем подсказки при клике вне
        document.addEventListener('click', function(e) {
            if (!heroSearchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
                hideSuggestions();
            }
        });
        
        // Поддержка Enter
        heroSearchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = this.value.trim();
                if (query) {
                    // Перенаправляем на страницу поиска
                    window.location.href = `/properties?search=${encodeURIComponent(query)}`;
                }
            }
        });
        
        console.log('✅ Hero autocomplete инициализирован');
    }
    
    // Функция получения подсказок
    function fetchSuggestions(query) {
        console.log('🔍 Получение подсказок для:', query);
        
        fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`)
            .then(response => {
                if (!response.ok) throw new Error('API error');
                return response.json();
            })
            .then(data => {
                console.log('✅ Получено подсказок:', data.length);
                displaySuggestions(data);
            })
            .catch(error => {
                console.error('❌ Ошибка получения подсказок:', error);
                hideSuggestions();
            });
    }
    
    // Функция отображения подсказок
    function displaySuggestions(suggestions) {
        if (!suggestions || suggestions.length === 0) {
            hideSuggestions();
            return;
        }
        
        suggestionsContainer.innerHTML = '';
        
        suggestions.forEach(suggestion => {
            const item = document.createElement('div');
            item.className = 'px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors';
            
            // Определяем иконку по типу
            let icon = '📍';
            if (suggestion.type === 'city') icon = '🏙️';
            else if (suggestion.type === 'residential_complex') icon = '🏢';
            else if (suggestion.type === 'district') icon = '📍';
            else if (suggestion.type === 'developer') icon = '🏗️';
            else if (suggestion.type === 'street') icon = '🛣️';
            
            item.innerHTML = `
                <div class="flex items-start gap-3">
                    <span class="text-xl mt-0.5">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-gray-900">${escapeHtml(suggestion.text)}</div>
                        ${suggestion.subtitle ? `<div class="text-sm text-gray-600 mt-0.5">${escapeHtml(suggestion.subtitle)}</div>` : ''}
                    </div>
                </div>
            `;
            
            item.addEventListener('click', () => {
                if (suggestion.url) {
                    window.location.href = suggestion.url;
                } else {
                    heroSearchInput.value = suggestion.text;
                    hideSuggestions();
                }
            });
            
            suggestionsContainer.appendChild(item);
        });
        
        suggestionsContainer.classList.remove('hidden');
    }
    
    // Функция скрытия подсказок
    function hideSuggestions() {
        if (suggestionsContainer) {
            suggestionsContainer.classList.add('hidden');
        }
    }
    
    // Функция экранирования HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Немедленный старт инициализации
    if (document.readyState === 'loading') {
        // DOM еще загружается
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        // DOM уже загружен
        tryInit();
    }
})();

console.log('✅ hero-autocomplete.js загружен');
