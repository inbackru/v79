// ✅ ФИЛЬТРЫ ДЛЯ СТРАНИЦЫ СВОЙСТВ - AJAX MODE
console.log('🔥 property-filters.js загружается - AJAX MODE...');

// ⚡ Функции открытия/закрытия модального окна фильтров
window.toggleFiltersModal = function() {
    console.log('🔄 toggleFiltersModal called');
    const modal = document.getElementById('filters-modal');
    if (modal) {
        modal.classList.toggle('hidden');
        if (!modal.classList.contains('hidden')) {
            document.body.style.overflow = 'hidden';
            window.updateFilteredCount();
        } else {
            document.body.style.overflow = '';
        }
    }
};

window.openFiltersModal = window.toggleFiltersModal;
window.closeFiltersModal = window.toggleFiltersModal;

// ✅ Получить текущее состояние фильтров
window.getFiltersState = function() {
    const state = {};
    
    // Вспомогательная функция для получения значения из инпутов (приоритет модальным окнам)
    const getValue = (ids) => {
        if (!Array.isArray(ids)) ids = [ids];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el && el.value && el.value.trim() !== '') {
                console.log(`🎯 getValue found value for ${id}:`, el.value.trim());
                return el.value.trim();
            }
        }
        return null;
    };

    // Text search
    const searchValue = getValue(['modal-search-input', 'property-search', 'property-search-desktop']);
    if (searchValue) state.search = searchValue;
    
    // Property Type
    const propertyTypeRadio = document.querySelector('input[name="property_type"]:checked');
    if (propertyTypeRadio && propertyTypeRadio.value !== 'all') {
        state.property_type = propertyTypeRadio.value;
    }
    
    const getCheckedValues = (selector) => {
        return Array.from(document.querySelectorAll(selector + ':checked')).map(cb => cb.value);
    };

    // Rooms
    const rooms = getCheckedValues('input[data-filter-type="rooms"]');
    if (rooms.length > 0) state.rooms = [...new Set(rooms)];
    
    // Price
    const pMin = getValue(['priceFromModalInput', 'priceFromInput', 'priceFrom']);
    const pMax = getValue(['priceToModalInput', 'priceToInput', 'priceTo']);
    if (pMin) state.price_min = parseFloat(pMin) < 1000 ? Math.round(parseFloat(pMin) * 1000000) : pMin;
    if (pMax) state.price_max = parseFloat(pMax) < 1000 ? Math.round(parseFloat(pMax) * 1000000) : pMax;
    
    // Area
    const aMin = getValue(['areaFromModal', 'quickAreaFrom', 'areaFrom', 'mapAreaFrom']);
    const aMax = getValue(['areaToModal', 'quickAreaTo', 'areaTo', 'mapAreaTo']);
    
    console.log('📐 Area Extraction:', { aMin, aMax });
    
    if (aMin) state.area_min = aMin;
    if (aMax) state.area_max = aMax;
    
    // Floor
    const fMin = getValue(['floorFromModal', 'quickFloorFrom', 'floorFrom']);
    const fMax = getValue(['floorToModal', 'quickFloorTo', 'floorTo']);
    if (fMin) state.floor_min = fMin;
    if (fMax) state.floor_max = fMax;
    
    // Max Floor (building floors)
    const mfMin = getValue(['maxFloorFromModal', 'maxFloorFromDesktop', 'maxFloorFrom']);
    const mfMax = getValue(['maxFloorToModal', 'maxFloorToDesktop', 'maxFloorTo']);
    if (mfMin) state.building_floors_min = mfMin;
    if (mfMax) state.building_floors_max = mfMax;

    // Multi-select
    ['districts', 'developers', 'floor_options', 'completion', 'object_classes', 'renovation', 'features', 'building_types', 'building_released'].forEach(type => {
        const values = getCheckedValues(`input[data-filter-type="${type}"]`);
        if (values.length > 0) state[type] = [...new Set(values)];
    });

    const urlParams = new URLSearchParams(window.location.search);
    const residentialComplex = urlParams.get('residential_complex');
    if (residentialComplex) state.residential_complex = residentialComplex;
    
    const developerName = urlParams.get('developer');
    if (developerName) state.developer = developerName;

    const cityIdMeta = document.querySelector('meta[name="city-id"]');
    if (cityIdMeta) state.city_id = cityIdMeta.content;
    
    return state;
};

// Сильный метод сбора и применения фильтров
window.applyFiltersManual = function() {
    console.log('🚀 Final Filter Application (applyFiltersManual)');
    const filters = window.getFiltersState();
    const params = new URLSearchParams();
    
    Object.entries(filters).forEach(([k, v]) => {
        if (Array.isArray(v)) {
            v.forEach(val => {
                const paramName = k.endsWith('[]') ? k : k + '[]';
                params.append(paramName, val);
            });
        } else if (v !== null && v !== undefined && v !== '') {
            params.append(k, v);
        }
    });

    const finalUrl = `${window.location.pathname}?${params.toString()}`;
    console.log('🚀 Redirecting to:', finalUrl);
    window.location.href = finalUrl;
};

// Основной метод теперь ссылается на усиленный
window.applyFilters = window.applyFiltersManual;

// Обновление отображения активных фильтров (чипсы)
window.updateActiveFiltersDisplay = function() {
    const filters = window.getFiltersState();
    const list = document.getElementById('active-filters-list');
    const container = document.getElementById('active-filters-container');
    
    if (!list) return;
    list.innerHTML = '';
    let hasFilters = false;

    const addChip = (label, key, value = null) => {
        hasFilters = true;
        const chip = document.createElement('div');
        chip.className = 'flex items-center gap-1 bg-blue-50 text-[#0088CC] px-3 py-1 rounded-full text-sm border border-blue-100 transition-all hover:bg-blue-100 whitespace-nowrap';
        const safeValue = value ? `'${value.replace(/'/g, "\\'")}'` : 'null';
        chip.innerHTML = `<span>${label}</span><button class="ml-1 hover:text-red-500" onclick="window.removeFilter('${key}', ${safeValue})"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>`;
        list.appendChild(chip);
    };

    if (filters.search) addChip(`Поиск: ${filters.search}`, 'search');
    if (filters.residential_complex) addChip(`ЖК: ${filters.residential_complex}`, 'residential_complex');
    if (filters.developer) addChip(`Застройщик: ${filters.developer}`, 'developer');
    if (filters.property_type) {
        const labels = { 'apartments': 'Квартира', 'houses': 'Дом', 'townhouses': 'Таунхаус', 'penthouses': 'Пентхаус', 'apartments_commercial': 'Апартаменты' };
        addChip(`Тип: ${labels[filters.property_type] || filters.property_type}`, 'property_type');
    }
    if (filters.rooms) filters.rooms.forEach(r => addChip(r === '0' ? 'Студия' : `${r}-к`, 'rooms', r));
    
    if (filters.price_min) addChip(`От ${(parseFloat(filters.price_min)/1000000).toFixed(1).replace('.0', '')} млн`, 'price_min');
    if (filters.price_max) addChip(`До ${(parseFloat(filters.price_max)/1000000).toFixed(1).replace('.0', '')} млн`, 'price_max');
    
    if (filters.area_min) addChip(`Пл. от ${filters.area_min} м²`, 'area_min');
    if (filters.area_max) addChip(`Пл. до ${filters.area_max} м²`, 'area_max');
    if (filters.floor_min) addChip(`Этаж от ${filters.floor_min}`, 'floor_min');
    if (filters.floor_max) addChip(`Этаж до ${filters.floor_max}`, 'floor_max');
    
    if (filters.districts) filters.districts.forEach(d => addChip(d, 'districts', d));
    if (filters.developers) filters.developers.forEach(d => addChip(window.developersMap?.[d] || `Застройщик ${d}`, 'developers', d));
    
    if (filters.building_floors_min) addChip('Этажей от ' + filters.building_floors_min, 'building_floors_min');
    if (filters.building_floors_max) addChip('Этажей до ' + filters.building_floors_max, 'building_floors_max');

    var multiLabels = {
        'floor_options': { 'not_first': 'Не первый', 'not_last': 'Не последний', 'last': 'Последний', 'first': 'Первый' },
        'renovation': { 'no_renovation': 'Без отделки', 'fine_finish': 'Чистовая', 'rough_finish': 'Черновая', 'pre_finish': 'Предчистовая', 'turnkey': 'Под ключ' },
        'features': { 'accreditation': 'Аккредитация', 'green_mortgage': 'Льготная ипотека' },
        'building_released': { 'true': 'Сданный дом', 'false': 'В строительстве' }
    };
    
    ['floor_options', 'renovation', 'features', 'object_classes', 'building_released'].forEach(function(key) {
        if (filters[key]) {
            filters[key].forEach(function(val) { addChip(multiLabels[key] && multiLabels[key][val] || val, key, val); });
        }
    });
    if (filters.completion) {
        filters.completion.forEach(function(val) { addChip('Сдача ' + val + ' г.', 'completion', val); });
    }
    
    if (container) container.classList.toggle('hidden', !hasFilters);
};

window.removeFilter = function(key, value, skipApply) {
    var groupKeys = {
        'area': ['area_min', 'area_max'],
        'floor': ['floor_min', 'floor_max'],
        'building_floors': ['building_floors_min', 'building_floors_max'],
        'price': ['price_min', 'price_max']
    };
    if (groupKeys[key]) {
        groupKeys[key].forEach(function(k) { window.removeFilter(k, null, true); });
        window.applyFilters();
        return;
    }

    if (value && value !== 'null') {
        var selectors = [
            'input[data-filter-type="'+key+'"][value="'+value+'"]', 
            'input[name="'+key+'"][value="'+value+'"]', 
            'input[data-filter-type="'+key.replace(/\[\]$/, '')+'"][value="'+value+'"]'
        ];
        selectors.forEach(function(s) { document.querySelectorAll(s).forEach(function(el) { el.checked = false; }); });
    }
    
    var ids = [
        key, key+'Input', key+'Modal', key+'ModalInput', 
        key.replace('_min', 'From')+'Input', key.replace('_max', 'To')+'Input', 
        key.replace('_min', 'From')+'Modal', key.replace('_max', 'To')+'Modal',
        key.replace('building_floors_min', 'maxFloorFromModal'), key.replace('building_floors_max', 'maxFloorToModal'),
        key.replace('building_floors_min', 'maxFloorFromDesktop'), key.replace('building_floors_max', 'maxFloorToDesktop'),
        key.replace('area_min', 'areaFromModal'), key.replace('area_max', 'areaToModal'),
        key.replace('floor_min', 'floorFromModal'), key.replace('floor_max', 'floorToModal'),
        key.replace('price_min', 'priceFromInput'), key.replace('price_max', 'priceToInput'),
        'quickAreaFrom', 'quickAreaTo', 'quickFloorFrom', 'quickFloorTo'
    ];
    ids.forEach(function(id) { var el = document.getElementById(id); if(el) el.value = ''; });

    if (key === 'property_type') document.querySelectorAll('input[name="property_type"]').forEach(function(r) { r.checked = (r.value === 'all'); });
    if (key === 'search') ['property-search', 'property-search-desktop', 'modal-search-input'].forEach(function(id) { var el = document.getElementById(id); if(el) el.value = ''; });
    if (key === 'residential_complex' || key === 'developer') {
        var url = new URL(window.location.href);
        url.searchParams.delete(key);
        window.location.href = url.toString();
        return;
    }
    
    if (!skipApply) window.applyFilters();
};

window.updateFilteredCount = function() {
    const filters = window.getFiltersState();
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach(val => params.append(k.endsWith('[]') ? k : k+'[]', val));
        else params.append(k, v);
    });

    console.log('📡 Updating count with:', params.toString());
    fetch(`/api/properties/list?${params.toString()}`)
        .then(r => r.json())
        .then(d => {
            const count = d.pagination?.total || 0;
            console.log('✅ Real-time Count:', count);
            
            const countIDs = ['priceFilteredCountDisplay', 'modal-filtered-count', 'roomsFilteredCount', 'filteredResultsCount', 'priceFilteredCount'];
            countIDs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = count;
            });
            
            const buttonIDs = ['apply-filters-modal-btn-id', 'apply-advanced-filters-id'];
            buttonIDs.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const span = el.querySelector('span[id]');
                    if (span) span.textContent = count;
                    else el.textContent = `Показать ${count} объектов`;
                }
            });

            document.querySelectorAll('.properties-count-display, .properties-found-count').forEach(el => {
                el.textContent = el.classList.contains('properties-found-count') ? count : `${count} объектов`;
            });
        });
};

// Shortcuts for backward compatibility
window.applyPriceFilterModal = window.applyFilters;
window.applyPriceFilter = window.applyFilters;
window.applyModalFilters = window.applyFilters;
window.applyRoomsFilter = window.applyFilters;
window.updateAdvancedFiltersCounter = window.updateFilteredCount;
window.updateModalFilterCount = window.updateFilteredCount;

window.loadDevelopers = function() {
    const cityMeta = document.querySelector('meta[name="city-id"]');
    const cityId = cityMeta ? cityMeta.content : '1';
    
    fetch(`/api/developers?city_id=${cityId}`)
        .then(r => r.json())
        .then(data => {
            if (!data.developers || !data.developers.length) return;
            
            const urlParams = new URLSearchParams(window.location.search);
            const selectedDevs = urlParams.getAll('developers[]').concat(urlParams.getAll('developers'));
            
            const filterContainerIds = ['developers-advanced-filters', 'developers-mobile-modal', 'developers-modal-panel'];
            window.developersMap = {};
            data.developers.forEach(d => { window.developersMap[String(d.id)] = d.name; });
            
            filterContainerIds.forEach(id => {
                const container = document.getElementById(id);
                if (!container) return;
                container.innerHTML = data.developers.map(d => `
                    <label class="flex items-center hover:bg-gray-50 p-1.5 rounded-lg cursor-pointer">
                        <input type="checkbox" value="${d.id}" data-filter-type="developers" 
                               class="text-[#0088CC] focus:ring-[#0088CC] border-gray-300 rounded"
                               onchange="window.updateFilteredCount();"
                               ${selectedDevs.includes(String(d.id)) ? 'checked' : ''}>
                        <span class="ml-2 text-sm text-gray-700">${d.name}</span>
                    </label>
                `).join('');
            });
            
            const mapContainer = document.getElementById('mapDevelopersList');
            if (mapContainer) {
                mapContainer.innerHTML = data.developers.map(d => `
                    <label class="flex items-center hover:bg-gray-50 p-2 rounded-lg cursor-pointer">
                        <input type="checkbox" value="${d.id}" data-map-filter="developer" 
                               class="text-blue-600 focus:ring-blue-500 border-gray-300 rounded">
                        <span class="ml-2 text-sm text-gray-700">${d.name}</span>
                    </label>
                `).join('');
            }
        })
        .catch(e => console.error('Failed to load developers:', e));
};

document.addEventListener('DOMContentLoaded', () => {
    window.loadDevelopers();
    
    // Initial restoration
    const params = new URLSearchParams(window.location.search);
    params.forEach((v, k) => {
        const clean = k.replace(/\[\]$/, '');
        document.querySelectorAll(`input[data-filter-type="${clean}"][value="${v}"], input[name="${clean}"][value="${v}"]`).forEach(el => el.checked = true);
        
        const ids = [
            clean, clean+'Input', clean+'ModalInput', 
            clean.replace('_min', 'From')+'Input', clean.replace('_max', 'To')+'Input', 
            clean.replace('_min', 'From')+'Modal', clean.replace('_max', 'To')+'Modal',
            clean.replace('building_floors_min', 'maxFloorFromModal'), clean.replace('building_floors_max', 'maxFloorToModal'),
            clean.replace('building_floors_min', 'maxFloorFromDesktop'), clean.replace('building_floors_max', 'maxFloorToDesktop'),
            clean.replace('area_min', 'areaFromModal'), clean.replace('area_max', 'areaToModal'),
            clean.replace('floor_min', 'floorFromModal'), clean.replace('floor_max', 'floorToModal'),
            clean.replace('price_min', 'priceFromInput'), clean.replace('price_max', 'priceToInput')
        ];
        
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.type.match(/radio|checkbox/)) {
                el.value = (clean.includes('price') && parseFloat(v) >= 1000) ? (parseFloat(v)/1000000).toFixed(1).replace('.0', '') : v;
            }
        });
    });
    
    setTimeout(() => { window.updateActiveFiltersDisplay(); window.updateFilteredCount(); }, 300);
    
    document.addEventListener('change', (e) => {
        if (e.target.closest('input')) {
            window.updateActiveFiltersDisplay();
            window.updateFilteredCount();
        }
    });
    
    document.addEventListener('input', (e) => {
        if (e.target.closest('input[type="number"], input[type="text"]')) {
            if (window._filterTimer) clearTimeout(window._filterTimer);
            window._filterTimer = setTimeout(window.updateFilteredCount, 500);
        }
    });
});
