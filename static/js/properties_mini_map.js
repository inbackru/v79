// Properties Mini Map (Yandex Maps - Avito-style)
console.log('🗺️ properties_mini_map.js загружен');

// CHECK META TAGS AT PAGE LOAD
const chkLat = document.querySelector('meta[name="city-lat"]');
const chkLon = document.querySelector('meta[name="city-lon"]');
if (chkLat && chkLon) {
    console.log(`✅ LOADED: city-lat=${chkLat.getAttribute('content')}, city-lon=${chkLon.getAttribute('content')}`);
} else {
    console.warn(`⚠️ META TAGS NOT FOUND at page load`);
}

// ✅ Helper function to get current filter parameters for mini-map API
function getMiniMapFilterParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    
    // City ID
    const cityId = window.currentCityId || urlParams.get('city_id');
    if (cityId) params.set('city_id', cityId);
    
    // Key filters that affect map display
    if (urlParams.get('residential_complex')) params.set('residential_complex', urlParams.get('residential_complex'));
    if (urlParams.get('developer')) params.set('developer', urlParams.get('developer'));
    
    function getAll(key) {
        return urlParams.getAll(key).concat(urlParams.getAll(key + '[]'));
    }
    
    getAll('rooms').forEach(r => params.append('rooms', r));
    
    if (urlParams.get('property_type') && urlParams.get('property_type') !== 'all') params.set('property_type', urlParams.get('property_type'));
    if (urlParams.get('price_min')) params.set('price_min', urlParams.get('price_min'));
    if (urlParams.get('price_max')) params.set('price_max', urlParams.get('price_max'));
    if (urlParams.get('area_min')) params.set('area_min', urlParams.get('area_min'));
    if (urlParams.get('area_max')) params.set('area_max', urlParams.get('area_max'));
    
    getAll('developers').forEach(d => params.append('developers', d));
    getAll('districts').forEach(d => params.append('districts', d));
    getAll('completion').forEach(v => params.append('completion', v));
    getAll('object_classes').forEach(v => params.append('object_classes', v));
    getAll('renovation').forEach(v => params.append('renovation', v));
    getAll('features').forEach(v => params.append('features', v));
    getAll('building_released').forEach(v => params.append('building_released', v));
    getAll('floor_options').forEach(v => params.append('floor_options', v));
    getAll('building_types').forEach(v => params.append('building_types', v));
    getAll('delivery_years').forEach(v => params.append('delivery_years', v));
    
    // Numeric range filters
    if (urlParams.get('floor_min')) params.set('floor_min', urlParams.get('floor_min'));
    if (urlParams.get('floor_max')) params.set('floor_max', urlParams.get('floor_max'));
    if (urlParams.get('building_floors_min')) params.set('building_floors_min', urlParams.get('building_floors_min'));
    if (urlParams.get('building_floors_max')) params.set('building_floors_max', urlParams.get('building_floors_max'));
    if (urlParams.get('build_year_min')) params.set('build_year_min', urlParams.get('build_year_min'));
    if (urlParams.get('build_year_max')) params.set('build_year_max', urlParams.get('build_year_max'));
    if (urlParams.get('cashback_only')) params.set('cashback_only', urlParams.get('cashback_only'));
    
    // Search filter from mapFilters (set by search input on map)
    if (window.mapFilters?.search) {
        params.set('search', window.mapFilters.search);
    } else if (urlParams.get('search')) {
        params.set('search', urlParams.get('search'));
    }
    
    const queryString = params.toString();
    console.log('🗺️ Mini-map filter params:', queryString || '(none)');
    return queryString;
}

// Make function globally available
window.getMiniMapFilterParams = getMiniMapFilterParams;

let miniPropertiesMapInstance = null;
let fullscreenMapInstance = null;
let mapInitTimeout = null;
let ymapsRetryTimeout = null;
let propertyIdToMarkerMap = {};  // ✅ Track markers by property ID for hover highlighting

// ✅ NEW: Variables for infinite scroll and viewport filtering
let currentDisplayOffset = 0;  // Offset for infinite scroll (how many cards loaded)
const CARDS_PER_PAGE = 20;     // Load 20 cards at a time
let isLoadingMoreCards = false; // Prevent multiple simultaneous loads
let currentViewportProperties = []; // Properties visible in current map viewport

// Check if device is mobile
function isMobileDevice() {
    return window.innerWidth <= 768;
}

function clusterCoordinates(coordinates, radius) {
    const clusters = [];
    const used = new Set();
    
    coordinates.forEach((coord, i) => {
        if (used.has(i)) return;
        
        const cluster = {
            lat: coord.lat,
            lng: coord.lng,
            count: 1
        };
        
        coordinates.forEach((other, j) => {
            if (i !== j && !used.has(j)) {
                const distance = Math.sqrt(
                    Math.pow(coord.lat - other.lat, 2) + 
                    Math.pow(coord.lng - other.lng, 2)
                );
                
                if (distance < radius) {
                    cluster.count++;
                    used.add(j);
                }
            }
        });
        
        used.add(i);
        clusters.push(cluster);
    });
    
    return clusters;
}

function initMiniPropertiesMap() {
    const mapElement = document.getElementById('miniPropertiesMap');
    if (!mapElement || miniPropertiesMapInstance) return;
    
    if (typeof ymaps === 'undefined') {
        console.warn('ymaps not loaded yet, retrying in 500ms');
        setTimeout(initMiniPropertiesMap, 500);
        return;
    }
    
    ymaps.ready(function() {
        try {
            // Начальный центр (Краснодарский край) - будет пересчитан после загрузки объектов
            miniPropertiesMapInstance = new ymaps.Map('miniPropertiesMap', {
                center: [45.0355, 38.9753],
                zoom: 11,
                controls: []
            }, {
                suppressMapOpenBlock: true,
                yandexMapDisablePoiInteractivity: true
            });
            
            miniPropertiesMapInstance.behaviors.disable(['drag', 'scrollZoom', 'dblClickZoom', 'multiTouch']);
            
            const miniMapParams = getMiniMapFilterParams();
            fetch('/api/mini-map/properties' + (miniMapParams ? '?' + miniMapParams : ''), {
                credentials: 'same-origin'
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.coordinates && data.coordinates.length > 0) {
                        console.log(`✅ Loaded ${data.count} property coordinates`);
                        
                        const clusters = clusterCoordinates(data.coordinates, 0.01);
                        
                        // Создаем метки на карте
                        clusters.forEach(cluster => {
                            const placemark = new ymaps.Placemark([cluster.lat, cluster.lng], {
                                iconContent: cluster.count
                            }, {
                                preset: 'islands#blueCircleIcon',
                                iconColor: '#0088CC'
                            });
                            
                            placemark.events.add('click', function(e) {
                                e.stopPropagation();
                                handleMapClick();
                            });
                            
                            miniPropertiesMapInstance.geoObjects.add(placemark);
                        });
                        
                        console.log(`✅ Created ${clusters.length} clusters on Yandex mini map`);
                        
                        // 🎯 АВТОМАТИЧЕСКОЕ ЦЕНТРИРОВАНИЕ ПО ОБЪЕКТАМ
                        // Вычисляем границы по всем координатам
                        const bounds = data.coordinates.reduce((acc, coord) => {
                            if (!acc.minLat || coord.lat < acc.minLat) acc.minLat = coord.lat;
                            if (!acc.maxLat || coord.lat > acc.maxLat) acc.maxLat = coord.lat;
                            if (!acc.minLng || coord.lng < acc.minLng) acc.minLng = coord.lng;
                            if (!acc.maxLng || coord.lng > acc.maxLng) acc.maxLng = coord.lng;
                            return acc;
                        }, {});
                        
                        // Устанавливаем карту по границам объектов с небольшим отступом
                        miniPropertiesMapInstance.setBounds([
                            [bounds.minLat, bounds.minLng],
                            [bounds.maxLat, bounds.maxLng]
                        ], {
                            checkZoomRange: true,
                            zoomMargin: 20  // Отступ от краев в пикселях
                        });
                        
                        console.log(`🎯 Auto-centered map: [${bounds.minLat.toFixed(4)}, ${bounds.minLng.toFixed(4)}] - [${bounds.maxLat.toFixed(4)}, ${bounds.maxLng.toFixed(4)}]`);
                    }
                })
                .catch(error => {
                    console.error('❌ Error loading property coordinates:', error);
                });
            
            console.log('✅ Yandex mini map initialized for properties');
        } catch (error) {
            console.error('❌ Error initializing Yandex mini map:', error);
        }
    });
}

// Open fullscreen map modal (Mobile + Desktop responsive)
function openFullscreenMap() {
    console.log('🔥🔥🔥 FULLSCREEN MAP OPENING - START');
    const modal = document.getElementById('fullscreenMapModal');
    if (!modal) { console.error('❌ Modal not found'); return; }
    
    const isMobile = window.innerWidth <= 1024;
    console.log(`🗺️ Opening fullscreen map modal (${isMobile ? 'mobile' : 'desktop'})`)
    console.log(`📊 ymaps exists: ${typeof ymaps !== 'undefined'}`)
    console.log(`📊 fullscreenMapInstance: ${typeof window.fullscreenMapInstance}`)
    console.log(`📊 mapAllProperties: ${Array.isArray(window.mapAllProperties) ? window.mapAllProperties.length + ' items' : 'NOT FOUND'};`);
    
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Load desktop filters if not mobile
    if (!isMobile) {
        setTimeout(() => {
            console.log('📋 Loading desktop filters...');
            loadMapDesktopDistricts();
            loadMapDevelopers();
        }, 50);
    }
    
    // Initialize map after modal is visible, store timeout to cancel if needed
    mapInitTimeout = setTimeout(() => {
        // Double-check modal is still open before initializing
        if (!modal.classList.contains('hidden')) {
            initFullscreenMap();
        }
        mapInitTimeout = null;
    }, 100);
}

// Group properties by coordinates
function groupPropertiesByCoords(properties) {
    const groups = {};
    
    properties.forEach(property => {
        // Check both formats: direct latitude/longitude and coordinates object
        const lat = property.latitude || (property.coordinates && property.coordinates.lat);
        const lng = property.longitude || (property.coordinates && property.coordinates.lng);
        
        if (lat && lng) {
            const key = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
            if (!groups[key]) {
                groups[key] = {
                    lat: lat,
                    lng: lng,
                    properties: []
                };
            }
            // Ensure property has coordinates in expected format for marker creation
            if (!property.coordinates) {
                property.coordinates = { lat: lat, lng: lng };
            }
            groups[key].properties.push(property);
        }
    });
    
    return Object.values(groups);
}

// Format price for display
function formatPrice(price) {
    if (!price) return 'По запросу';
    return new Intl.NumberFormat('ru-RU').format(price) + ' ₽';
}

// Get completion status and color for marker - based on COMPLETION DATE and DEAL TYPE
function getPropertyStatusColor(properties) {
    const statuses = properties.map(p => {
        // Log first property for debugging
        if (properties.indexOf(p) === 0) {
            console.log('🟡 STATUS DEBUG:', {
                id: p.id,
                completion_date: p.completion_date,
                completion_year: p.completion_year,
                deal_type: p.deal_type,
                complex_building_status: p.complex_building_status,
                complex_building_end_build_year: p.complex_building_end_build_year
            });
        }
        
        // 1. Check deal_type first (presale = RED)
        if (p.deal_type) {
            const dealType = String(p.deal_type).toLowerCase();
            if (dealType === 'presale' || dealType === 'первичка') return 'Старт продаж';
        }
        
        // 2. Check completion_date (quarter like "4 кв. 2025")
        if (p.completion_date) {
            const dateStr = String(p.completion_date).toLowerCase();
            const now = new Date();
            const currentYear = now.getFullYear();
            
            // Parse quarter: "4 кв. 2025" -> year 2025
            const yearMatch = dateStr.match(/\d{4}/);
            if (yearMatch) {
                const complYear = parseInt(yearMatch[0]);
                if (complYear < currentYear) {
                    return 'Сдан'; // GREEN - already completed
                } else if (complYear === currentYear) {
                    return 'Строится'; // YELLOW - completing this year
                } else {
                    return 'Старт продаж'; // RED - future completion
                }
            }
        }
        
        // 3. Check completion_year
        if (p.completion_year) {
            const complYear = parseInt(p.completion_year);
            if (!isNaN(complYear)) {
                const now = new Date().getFullYear();
                if (complYear < now) return 'Сдан';
                if (complYear === now) return 'Строится';
                return 'Старт продаж';
            }
        }
        
        // 4. Check complex building status
        if (p.complex_building_status) {
            const status = String(p.complex_building_status).toLowerCase();
            if (status.includes('сдан')) return 'Сдан';
            if (status.includes('строит')) return 'Строится';
            if (status.includes('старт') || status.includes('presale')) return 'Старт продаж';
        }
        
        // 5. Check complex end year
        if (p.complex_building_end_build_year) {
            const year = parseInt(p.complex_building_end_build_year);
            if (!isNaN(year)) {
                const now = new Date().getFullYear();
                if (year < now) return 'Сдан';
                if (year === now) return 'Строится';
                return 'Старт продаж';
            }
        }
        
        // Default
        return 'Строится';
    });
    
    const hasDelivered = statuses.includes('Сдан');
    const hasUnderConstruction = statuses.includes('Строится');
    const hasPresale = statuses.includes('Старт продаж');
    
    // Priority: Delivered (green) > Under construction (yellow) > Presale (red)
    if (hasDelivered) return { color: '#22c55e', status: 'Сдан' }; // green
    if (hasUnderConstruction) return { color: '#eab308', status: 'Строится' }; // yellow
    if (hasPresale) return { color: '#ef4444', status: 'Старт продаж' }; // red
    return { color: '#eab308', status: 'Строится' }; // default yellow
}

// Create enhanced Yandex Maps marker with status colors and price
function createEnhancedYandexMarker(properties) {
    if (!properties || !properties.length || !properties[0].coordinates) {
        return null;
    }
    
    const count = properties.length;
    const lat = properties[0].coordinates.lat;
    const lng = properties[0].coordinates.lng;
    const minPrice = Math.min(...properties.map(p => p.price || Infinity).filter(p => p !== Infinity));
    const priceText = minPrice !== Infinity ? Math.round(minPrice / 1000000 * 10) / 10 + 'М' : '?';
    const statusInfo = getPropertyStatusColor(properties) || { color: '#0088CC', status: 'Строится' };
    
    // Create custom HTML marker with count, price, and status color
    const markerHTML = `
        <div style="
            background: ${statusInfo.color};
            color: white;
            padding: 6px 12px;
            border-radius: 20px;
            border: 2px solid white;
            font-size: 12px;
            font-weight: bold;
            white-space: nowrap;
            font-family: Inter, system-ui, sans-serif;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 3px 10px ${statusInfo.color}80;
        ">
            <span style="background: rgba(255,255,255,0.25); border-radius: 50%; min-width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; padding: 0 4px;">
                ${count}
            </span>
            <span>от ${priceText}₽</span>
        </div>
    `;
    
    // Use custom layout to render HTML
    const iconLayout = ymaps.templateLayoutFactory.createClass(markerHTML);
    
    // Create marker
    const marker = new ymaps.Placemark(
        [lat, lng],
        { balloonContent: count + ' объектов', hintContent: statusInfo.status },
        {
            iconLayout: iconLayout,
            iconShape: { type: 'Rectangle', coordinates: [[-60, -20], [60, 20]] }
        }
    );
    
    // Store properties
    marker._markerProperties = properties;
    marker._originalIconLayout = iconLayout;  // 🎯 Save original for restore on hover leave
    marker.originalPreset = 'islands#' + (statusInfo.color === '#22c55e' ? 'greenCircleIcon' : statusInfo.color === '#eab308' ? 'yellowCircleIcon' : 'redCircleIcon');
    marker.statusColor = statusInfo.color;
    
    // ✅ ИСПРАВЛЕНИЕ #1: Регистрируем маркер для КАЖДОГО свойства (для hover sync)
    properties.forEach(prop => {
        if (!window.propertyIdToMarkerMap) window.propertyIdToMarkerMap = {};
        if (!window.propertyIdToMarkerMap[prop.id]) {
            window.propertyIdToMarkerMap[prop.id] = [];
        }
        window.propertyIdToMarkerMap[prop.id].push(marker);
    });
    console.log(`✅ Registered marker for ${properties.length} properties`);
    
    // Click handler
    marker.events.add('click', function() {
        if (isMobileDevice()) {
            openPropertyBottomSheet(properties);
        } else {
            updateDesktopPropertiesPanel(properties, properties[0].complex_name || 'Объект');
        }
    });
    
    return marker;
}

// Create balloon content for Yandex Maps (Desktop only - no onerror to avoid warnings)
function createYandexBalloonContent(properties) {
    if (properties.length === 1) {
        const property = properties[0];
        const price = formatPrice(property.price);
        const rooms = property.rooms !== undefined && property.rooms !== null ? property.rooms : '?';
        const area = property.area || '?';
        const complex = property.residential_complex || property.complex_name || 'Жилой комплекс';
        const image = property.main_image || property.image || 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
        const cashback = property.cashback_rate || 0;
        
        return `
            <div style="min-width: 280px; max-width: 320px; font-family: Inter, sans-serif;">
                <div style="position: relative; height: 120px; overflow: hidden; border-radius: 8px 8px 0 0;">
                    <img src="${image}" style="width: 100%; height: 100%; object-fit: cover;" alt="${complex}">
                    ${cashback > 0 ? `<div style="position: absolute; top: 8px; right: 8px; background: linear-gradient(135deg, #FFB800, #FF8C00); color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 8px rgba(255,184,0,0.4);">Кешбек ${cashback}%</div>` : ''}
                </div>
                <div style="padding: 12px;">
                    <div style="font-weight: bold; font-size: 18px; color: #0088CC; margin-bottom: 8px;">${price}</div>
                    <div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">${rooms === 0 ? 'Студия' : rooms + '-комн.'}, ${area} м²</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">${complex}</div>
                    <a href="${property.url || '/object/' + property.id}" style="display: block; background: linear-gradient(135deg, #0088CC, #006699); color: white; text-align: center; padding: 10px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 13px;">Подробнее</a>
                </div>
            </div>
        `;
    } else {
        const complex = properties[0].residential_complex || properties[0].complex_name || 'Жилой комплекс';
        const image = properties[0].main_image || properties[0].image || 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
        const minPrice = Math.min(...properties.map(p => p.price || Infinity).filter(p => p !== Infinity));
        const maxPrice = Math.max(...properties.map(p => p.price || 0));
        const priceRange = minPrice !== Infinity ? formatPrice(minPrice) : 'По запросу';
        
        // Create scrollable property list
        let propertyList = '';
        properties.slice(0, 10).forEach(prop => {
            const price = formatPrice(prop.price);
            const rooms = prop.rooms || '?';
            const area = prop.area || '?';
            
            // Floor info
            const floor = prop.floor || null;
            const totalFloors = prop.total_floors || null;
            let floorText = '? этаж';
            if (floor && totalFloors) {
                floorText = `${floor}/${totalFloors} эт.`;
            } else if (floor) {
                floorText = `${floor} эт.`;
            }
            
            propertyList += `
                <div style="padding: 8px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 500; font-size: 12px; color: #1e293b;">${rooms === 0 ? 'Студия' : rooms + '-комн.'}, ${area} м²</div>
                        <div style="font-size: 11px; color: #64748b;">${floorText}</div>
                    </div>
                    <div>
                        <div style="font-weight: bold; color: #0088CC; font-size: 12px;">${price}</div>
                        <a href="${prop.url || '/object/' + prop.id}" style="font-size: 10px; color: #0088CC; text-decoration: none;">Подробнее →</a>
                    </div>
                </div>
            `;
        });
        
        return `
            <div style="min-width: 300px; max-width: 350px; font-family: Inter, sans-serif;">
                <div style="position: relative; height: 120px; overflow: hidden;">
                    <img src="${image}" style="width: 100%; height: 100%; object-fit: cover;" alt="${complex}">
                    <div style="position: absolute; top: 8px; right: 8px; background: linear-gradient(135deg, #FFB800, #FF8C00); color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 8px rgba(255,184,0,0.4);">${properties.length} квартир</div>
                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.6), transparent); height: 50px;"></div>
                    <h3 style="position: absolute; bottom: 8px; left: 8px; color: white; font-weight: bold; font-size: 14px; margin: 0; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">${complex}</h3>
                </div>
                <div style="padding: 12px;">
                    <div style="font-weight: bold; font-size: 18px; color: #0088CC; margin-bottom: 8px;">от ${priceRange}</div>
                    <div style="font-size: 12px; color: #64748b; margin-bottom: 12px;">Разные планировки и этажи</div>
                    <div style="max-height: 250px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 12px;">
                        ${propertyList}
                    </div>
                    ${properties.length > 10 ? `<div style="text-align: center; font-size: 11px; color: #64748b;">Показано 10 из ${properties.length} квартир</div>` : ''}
                </div>
            </div>
        `;
    }
}

// Sync map filters to URL params before closing
function syncMapFiltersToUrl() {
    const params = new URLSearchParams();
    let hasFilters = false;
    
    console.log('🔍 Syncing ALL map filters to URL:', window.mapFilters);
    
    if (window.mapFilters) {
        // ✅ QUICK FILTERS
        // Rooms
        if (Array.isArray(window.mapFilters.rooms) && window.mapFilters.rooms.length > 0) {
            params.set('rooms', window.mapFilters.rooms.join(','));
            hasFilters = true;
            console.log('✅ Added rooms:', window.mapFilters.rooms);
        }
        
        // ✅ PRICE RANGE (convert from millions to rubles)
        if (window.mapFilters.price_min && window.mapFilters.price_min !== '' && window.mapFilters.price_min !== 0) {
            const priceMinVal = parseFloat(window.mapFilters.price_min);
            // Convert millions to rubles if value is small (< 1000)
            const priceMinRubles = priceMinVal < 1000 ? priceMinVal * 1000000 : priceMinVal;
            params.set('price_min', priceMinRubles);
            hasFilters = true;
            console.log('✅ Added price_min:', priceMinRubles, '(input:', window.mapFilters.price_min, 'млн)');
        }
        if (window.mapFilters.price_max && window.mapFilters.price_max !== '' && window.mapFilters.price_max !== 0) {
            const priceMaxVal = parseFloat(window.mapFilters.price_max);
            // Convert millions to rubles if value is small (< 1000)
            const priceMaxRubles = priceMaxVal < 1000 ? priceMaxVal * 1000000 : priceMaxVal;
            params.set('price_max', priceMaxRubles);
            hasFilters = true;
            console.log('✅ Added price_max:', priceMaxRubles, '(input:', window.mapFilters.price_max, 'млн)');
        }
        
        // ✅ AREA RANGE
        if (window.mapFilters.area_min && window.mapFilters.area_min !== '') {
            params.set('area_min', window.mapFilters.area_min);
            hasFilters = true;
            console.log('✅ Added area_min:', window.mapFilters.area_min);
        }
        if (window.mapFilters.area_max && window.mapFilters.area_max !== '') {
            params.set('area_max', window.mapFilters.area_max);
            hasFilters = true;
            console.log('✅ Added area_max:', window.mapFilters.area_max);
        }
        
        // ✅ FLOOR RANGE
        if (window.mapFilters.floor_min && window.mapFilters.floor_min !== '') {
            params.set('floor_min', window.mapFilters.floor_min);
            hasFilters = true;
            console.log('✅ Added floor_min:', window.mapFilters.floor_min);
        }
        if (window.mapFilters.floor_max && window.mapFilters.floor_max !== '') {
            params.set('floor_max', window.mapFilters.floor_max);
            hasFilters = true;
            console.log('✅ Added floor_max:', window.mapFilters.floor_max);
        }
        
        // ✅ BUILDING FLOORS RANGE
        if (window.mapFilters.building_floors_min && window.mapFilters.building_floors_min !== '') {
            params.set('building_floors_min', window.mapFilters.building_floors_min);
            hasFilters = true;
            console.log('✅ Added building_floors_min:', window.mapFilters.building_floors_min);
        }
        if (window.mapFilters.building_floors_max && window.mapFilters.building_floors_max !== '') {
            params.set('building_floors_max', window.mapFilters.building_floors_max);
            hasFilters = true;
            console.log('✅ Added building_floors_max:', window.mapFilters.building_floors_max);
        }
        
        // ✅ BUILD YEAR RANGE
        if (window.mapFilters.build_year_min && window.mapFilters.build_year_min !== '') {
            params.set('build_year_min', window.mapFilters.build_year_min);
            hasFilters = true;
            console.log('✅ Added build_year_min:', window.mapFilters.build_year_min);
        }
        if (window.mapFilters.build_year_max && window.mapFilters.build_year_max !== '') {
            params.set('build_year_max', window.mapFilters.build_year_max);
            hasFilters = true;
            console.log('✅ Added build_year_max:', window.mapFilters.build_year_max);
        }
        
        // ✅ MULTI-SELECT FILTERS
        // Districts
        if (Array.isArray(window.mapFilters.districts) && window.mapFilters.districts.length > 0) {
            params.set('districts', window.mapFilters.districts.join(','));
            hasFilters = true;
            console.log('✅ Added districts:', window.mapFilters.districts);
        }
        
        // Developers
        if (Array.isArray(window.mapFilters.developers) && window.mapFilters.developers.length > 0) {
            params.set('developers', window.mapFilters.developers.join(','));
            hasFilters = true;
            console.log('✅ Added developers:', window.mapFilters.developers);
        }
        
        // Completion status
        if (Array.isArray(window.mapFilters.completion) && window.mapFilters.completion.length > 0) {
            params.set('completion', window.mapFilters.completion.join(','));
            hasFilters = true;
            console.log('✅ Added completion:', window.mapFilters.completion);
        }
        
        // Object classes
        if (Array.isArray(window.mapFilters.object_classes) && window.mapFilters.object_classes.length > 0) {
            params.set('object_classes', window.mapFilters.object_classes.join(','));
            hasFilters = true;
            console.log('✅ Added object_classes:', window.mapFilters.object_classes);
        }
        
        // Building status
        if (Array.isArray(window.mapFilters.building_status) && window.mapFilters.building_status.length > 0) {
            params.set('building_status', window.mapFilters.building_status.join(','));
            hasFilters = true;
            console.log('✅ Added building_status:', window.mapFilters.building_status);
        }
        
        // Features
        if (Array.isArray(window.mapFilters.features) && window.mapFilters.features.length > 0) {
            params.set('features', window.mapFilters.features.join(','));
            hasFilters = true;
            console.log('✅ Added features:', window.mapFilters.features);
        }
        
        // Building released
        if (Array.isArray(window.mapFilters.building_released) && window.mapFilters.building_released.length > 0) {
            params.set('building_released', window.mapFilters.building_released.join(','));
            hasFilters = true;
            console.log('✅ Added building_released:', window.mapFilters.building_released);
        }
        
        // Floor options
        if (Array.isArray(window.mapFilters.floor_options) && window.mapFilters.floor_options.length > 0) {
            params.set('floor_options', window.mapFilters.floor_options.join(','));
            hasFilters = true;
            console.log('✅ Added floor_options:', window.mapFilters.floor_options);
        }
        
        // Renovation
        if (Array.isArray(window.mapFilters.renovation) && window.mapFilters.renovation.length > 0) {
            params.set('renovation', window.mapFilters.renovation.join(','));
            hasFilters = true;
            console.log('✅ Added renovation:', window.mapFilters.renovation);
        }
    }
    
    // If we have filters, reload page with new params
    if (hasFilters && params.toString()) {
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        console.log('✅ ALL map filters synced to URL, reloading page:', newUrl);
        // Reload page to apply filters via endpoints
        window.location.href = newUrl;
        return true;
    }
    
    console.log('ℹ️ No map filters to sync - mapFilters state:', window.mapFilters);
    return false;
}

// Export to window for external access
window.syncMapFiltersToUrl = syncMapFiltersToUrl;

// Close map and sync filters to URL (for "Список" button click)
window.closeMapAndSyncFilters = function() {
    console.log('🗺️ closeMapAndSyncFilters() called - syncing before close');
    
    // 🔄 Try to sync filters first
    const hadFilters = syncMapFiltersToUrl();
    
    // If no filters, just close normally
    if (!hadFilters) {
        console.log('ℹ️ No filters to sync, closing normally');
        closeFullscreenMap();
    }
    // If filters were synced, page will reload via window.location.href
};

// Close fullscreen map modal
function closeFullscreenMap() {
    const modal = document.getElementById('fullscreenMapModal');
    if (!modal) return;
    
    console.log('🗺️ Closing fullscreen map modal');
    
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    
    // Cancel pending map initialization to prevent race condition
    if (mapInitTimeout) {
        clearTimeout(mapInitTimeout);
        mapInitTimeout = null;
    }
    
    // Cancel ymaps retry timeout
    if (ymapsRetryTimeout) {
        clearTimeout(ymapsRetryTimeout);
        ymapsRetryTimeout = null;
    }
    
    // Destroy map instance to free memory
    if (fullscreenMapInstance) {
        fullscreenMapInstance.destroy();
        fullscreenMapInstance = null;
    }
}

// Initialize fullscreen map with properties for CURRENT CITY
function initFullscreenMap() {
    const modal = document.getElementById('fullscreenMapModal');
    const isMobile = window.innerWidth <= 1024;
    const mapContainerId = isMobile ? 'fullscreenMapContainer' : 'fullscreenMapContainerDesktop';
    const mapContainer = document.getElementById(mapContainerId);
    const currentCityId = window.currentCityId || 1;
    
    // Bail out if modal is closed or map already exists
    if (!modal || modal.classList.contains('hidden') || !mapContainer || fullscreenMapInstance) {
        console.log('🗺️ Skipping map init - modal closed or map exists');
        return;
    }
    
    if (typeof ymaps === 'undefined') {
        console.warn('ymaps not loaded yet, retrying in 500ms');
        ymapsRetryTimeout = setTimeout(initFullscreenMap, 500);
        return;
    }
    
    ymaps.ready(function() {
        try {
            console.log(`🗺️ Initializing fullscreen Yandex Map for city ${currentCityId} (${isMobile ? 'mobile' : 'desktop'})`);
            
            // 🎯 STEP 0: Get current city coordinates from GLOBAL variables (set in template)
            let cityCoordinates = window.cityCoordinates || [45.0355, 38.9753]; // Default Krasnodar
            let cityZoom = window.cityZoom || 12;
            
            console.log(`✅ Using GLOBAL city coordinates: [${cityCoordinates[0]}, ${cityCoordinates[1]}], zoom: ${cityZoom}, city: ${window.currentCityName || 'Unknown'}`);
            
            // Also try meta tags as fallback
            const cityLatMeta = document.querySelector('meta[name="city-lat"]');
            const cityLonMeta = document.querySelector('meta[name="city-lon"]');
            if (cityLatMeta && cityLonMeta) {
                const lat = parseFloat(cityLatMeta.getAttribute('content'));
                const lon = parseFloat(cityLonMeta.getAttribute('content'));
                if (!isNaN(lat) && !isNaN(lon)) {
                    console.log(`📋 Meta tags: [${lat}, ${lon}] (fallback)`);
                }
            }
            
            // Create map with controls, centered on current city
            fullscreenMapInstance = new ymaps.Map(mapContainerId, {
                center: cityCoordinates,
                zoom: cityZoom,
                controls: ['zoomControl', 'geolocationControl']
            });
            
            // 🎨 Add click handler for drawing feature (Yandex Maps API 2.1)
            fullscreenMapInstance.events.add('click', function(e) {
                if (!isMapDrawing) return;
                
                try {
                    // Yandex Maps API 2.1: Use e.get('coords') to get [lat, lon]
                    let coords = e.get('coords');
                    
                    if (!coords || !Array.isArray(coords) || coords.length < 2) {
                        console.warn('⚠️ Could not get coordinates from event');
                        return;
                    }
                    
                    console.log(`🎨 ✅ CLICK at [${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]`);
                    
                    const clickPoint = coords;
                    
                    // Check if closing polygon (при клике рядом с первой точкой)
                    // Allow closing polygon with any number of points >= 3
                    if (drawingPoints.length >= 3) {
                        const firstPoint = drawingPoints[0];
                        // Distance in degrees: ~0.0005 degrees = ~50 meters
                        const dist = Math.sqrt(Math.pow(coords[0] - firstPoint[0], 2) + Math.pow(coords[1] - firstPoint[1], 2));
                        // 🎯 ИСПРАВЛЕНИЕ 1: Close polygon if clicking on 1st point OR within 50m
                        if (dist < 0.0005) { // ~50 meters for closing
                            console.log(`🎨 ✅ CLOSING POLYGON - distance: ${(dist * 111000).toFixed(0)} meters (clicked on/near first point)`);
                            finishMapDrawing();
                            return;
                        }
                        // 🎯 Also allow closing by clicking DIRECTLY on first point (pixel-level)
                        if (drawingPoints.length >= 3 && dist < 0.00001) { // Very close (< 1m)
                            console.log(`🎨 ✅ CLOSING POLYGON - clicked directly on first point!`);
                            finishMapDrawing();
                            return;
                        }
                    }
                    
                    drawingPoints.push(clickPoint);
                    console.log(`🎨 Point ${drawingPoints.length} added`);
                    
                    // Add marker
                    const marker = new ymaps.Placemark(clickPoint, {}, {
                        preset: drawingPoints.length === 1 ? 'islands#greenCircleDotIcon' : 'islands#orangeCircleDotIcon'
                    });
                    fullscreenMapInstance.geoObjects.add(marker);
                    drawingMarkers.push(marker);
                    
                    // 🎯 ИСПРАВЛЕНИЕ: Add click handler to first marker (green circle) to close polygon
                    if (drawingPoints.length === 1) {
                        marker.events.add('click', function(e) {
                            // Stop propagation so map click handler doesn't add another point
                            if (e && e.stopPropagation) {
                                e.stopPropagation();
                            }
                            console.log('🎯 GREEN MARKER CLICKED - closing polygon');
                            if (drawingPoints.length >= 3) {
                                console.log('✅ Closing polygon by clicking green marker');
                                finishMapDrawing();
                            } else {
                                console.warn('⚠️ Need at least 3 points, currently have:', drawingPoints.length);
                            }
                        });
                    }
                    
                    // Update polyline
                    if (drawingPolyline) {
                        fullscreenMapInstance.geoObjects.remove(drawingPolyline);
                    }
                    if (drawingPoints.length >= 2) {
                        drawingPolyline = new ymaps.Polyline(drawingPoints, {}, {
                            strokeColor: '#ff6b35',
                            strokeWidth: 3,
                            strokeOpacity: 0.8
                        });
                        fullscreenMapInstance.geoObjects.add(drawingPolyline);
                    }
                } catch (err) {
                    console.error('❌ Drawing error:', err?.message || err?.toString() || err);
                }
            });
            
            // 🎯 STEP 1: Load coordinates for current city only (with ALL URL filters)
            const urlParams = new URLSearchParams(window.location.search);
            const urlFilters = new URLSearchParams();
            urlFilters.set('city_id', currentCityId);
            
            function getUrlList(key) {
                const plain = urlParams.getAll(key);
                const bracket = urlParams.getAll(key + '[]');
                return plain.concat(bracket);
            }
            
            const developerFilter = urlParams.get('developer');
            if (developerFilter) urlFilters.set('developer', developerFilter);
            getUrlList('developers').forEach(d => urlFilters.append('developers', d));
            
            const districtFilter = urlParams.get('district');
            if (districtFilter) urlFilters.set('district', districtFilter);
            getUrlList('districts').forEach(d => urlFilters.append('districts', d));
            
            getUrlList('rooms').forEach(r => urlFilters.append('rooms', r));
            
            const priceMin = urlParams.get('price_min');
            const priceMax = urlParams.get('price_max');
            if (priceMin) {
                const val = parseFloat(priceMin);
                urlFilters.set('price_min', val < 1000 ? val * 1000000 : val);
            }
            if (priceMax) {
                const val = parseFloat(priceMax);
                urlFilters.set('price_max', val < 1000 ? val * 1000000 : val);
            }
            
            if (urlParams.get('area_min')) urlFilters.set('area_min', urlParams.get('area_min'));
            if (urlParams.get('area_max')) urlFilters.set('area_max', urlParams.get('area_max'));
            
            if (urlParams.get('floor_min')) urlFilters.set('floor_min', urlParams.get('floor_min'));
            if (urlParams.get('floor_max')) urlFilters.set('floor_max', urlParams.get('floor_max'));
            
            getUrlList('completion').forEach(c => urlFilters.append('completion', c));
            getUrlList('building_status').forEach(s => urlFilters.append('building_status', s));
            getUrlList('object_classes').forEach(c => urlFilters.append('object_classes', c));
            getUrlList('renovation').forEach(r => urlFilters.append('renovation', r));
            getUrlList('features').forEach(f => urlFilters.append('features', f));
            getUrlList('building_released').forEach(b => urlFilters.append('building_released', b));
            getUrlList('floor_options').forEach(f => urlFilters.append('floor_options', f));
            getUrlList('building_types').forEach(b => urlFilters.append('building_types', b));
            getUrlList('delivery_years').forEach(y => urlFilters.append('delivery_years', y));
            
            const ptFilter = urlParams.get('property_type');
            if (ptFilter && ptFilter !== 'all') urlFilters.set('property_type', ptFilter);
            
            const rcFilter = urlParams.get('residential_complex');
            if (rcFilter) urlFilters.set('residential_complex', rcFilter);
            
            const searchQuery = urlParams.get('search');
            if (searchQuery) urlFilters.set('search', searchQuery);
            
            if (urlParams.get('building_floors_min')) urlFilters.set('building_floors_min', urlParams.get('building_floors_min'));
            if (urlParams.get('building_floors_max')) urlFilters.set('building_floors_max', urlParams.get('building_floors_max'));
            
            const cashbackOnly = urlParams.get('cashback_only');
            if (cashbackOnly === 'true' || cashbackOnly === '1') urlFilters.set('cashback_only', 'true');
            
            console.log('🔍 Fullscreen map URL filters:', urlFilters.toString());
            
            if (typeof mapFilters !== 'undefined') {
                getUrlList('rooms').forEach(r => { const n = parseInt(r); if (!isNaN(n) && !mapFilters.rooms.includes(n)) mapFilters.rooms.push(n); });
                if (priceMin) mapFilters.price_min = priceMin;
                if (priceMax) mapFilters.price_max = priceMax;
                if (urlParams.get('area_min')) mapFilters.area_min = urlParams.get('area_min');
                if (urlParams.get('area_max')) mapFilters.area_max = urlParams.get('area_max');
                if (urlParams.get('floor_min')) mapFilters.floor_min = urlParams.get('floor_min');
                if (urlParams.get('floor_max')) mapFilters.floor_max = urlParams.get('floor_max');
                getUrlList('developers').forEach(d => { if (!mapFilters.developers.includes(d)) mapFilters.developers.push(d); });
                getUrlList('completion').forEach(c => { if (!mapFilters.completion.includes(c)) mapFilters.completion.push(c); });
                getUrlList('object_classes').forEach(c => { if (!mapFilters.object_classes.includes(c)) mapFilters.object_classes.push(c); });
                getUrlList('building_status').forEach(s => { if (!mapFilters.building_status) mapFilters.building_status = []; if (!mapFilters.building_status.includes(s)) mapFilters.building_status.push(s); });
                getUrlList('renovation').forEach(r => { if (!mapFilters.renovation) mapFilters.renovation = []; if (!mapFilters.renovation.includes(r)) mapFilters.renovation.push(r); });
                getUrlList('features').forEach(f => { if (!mapFilters.features) mapFilters.features = []; if (!mapFilters.features.includes(f)) mapFilters.features.push(f); });
                getUrlList('building_released').forEach(b => { if (!mapFilters.building_released) mapFilters.building_released = []; if (!mapFilters.building_released.includes(b)) mapFilters.building_released.push(b); });
                getUrlList('floor_options').forEach(f => { if (!mapFilters.floor_options) mapFilters.floor_options = []; if (!mapFilters.floor_options.includes(f)) mapFilters.floor_options.push(f); });
                getUrlList('building_types').forEach(b => { if (!mapFilters.building_types) mapFilters.building_types = []; if (!mapFilters.building_types.includes(b)) mapFilters.building_types.push(b); });
                getUrlList('delivery_years').forEach(y => { if (!mapFilters.delivery_years) mapFilters.delivery_years = []; if (!mapFilters.delivery_years.includes(y)) mapFilters.delivery_years.push(y); });
                if (urlParams.get('building_floors_min')) mapFilters.building_floors_min = urlParams.get('building_floors_min');
                if (urlParams.get('building_floors_max')) mapFilters.building_floors_max = urlParams.get('building_floors_max');
                if (cashbackOnly === 'true' || cashbackOnly === '1') mapFilters.cashback_only = true;
                if (ptFilter && ptFilter !== 'all') mapFilters.property_type = ptFilter;
            }
            
            fetch(`/api/mini-map/properties?${urlFilters.toString()}`, {
                credentials: 'same-origin'
            })
                .then(response => response.json())
                .then(coordsData => {
                    if (!coordsData.success || !coordsData.coordinates || coordsData.coordinates.length === 0) {
                        console.warn('⚠️ No coordinates loaded for current city');
                        return;
                    }
                    
                    console.log(`✅ Loaded ${coordsData.count} coordinates for city ${currentCityId}`);
                    
                    // 🎯 STEP 2: Load property data for current city only
                    const fetchCityProperties = async () => {
                        let allProperties = [];
                        let page = 1;
                        let totalPages = 1;
                        
                        do {
                            const response = await fetch(`/api/map-properties?${urlFilters.toString()}&per_page=500&page=${page}`);
                            const data = await response.json();
                            
                            if (!data.success || !data.properties) {
                                break;
                            }
                            
                            allProperties = allProperties.concat(data.properties);
                            totalPages = data.pagination?.pages || 1;
                            page++;
                            
                            console.log(`📥 Fetched page ${page-1}/${totalPages}, total so far: ${allProperties.length}`);
                        } while (page <= totalPages);
                        
                        return allProperties;
                    };
                    
                    // Execute the async function
                    return fetchCityProperties()
                        .then(allProperties => {
                            if (!allProperties || allProperties.length === 0) {
                                console.warn('⚠️ No properties loaded');
                                return;
                            }
                            
                            console.log(`✅ Loaded ${allProperties.length} full properties`);
                            
                            // Update counter for both mobile and desktop
                            const counter = document.getElementById('mapObjectsCount');
                            const desktopCounter = document.getElementById('mapObjectsCountDesktop');
                            if (counter) {
                                counter.textContent = allProperties.length;
                            }
                            if (desktopCounter) {
                                desktopCounter.textContent = allProperties.length;
                            }
                            
                            // Desktop: Load property cards into center panel with 2-column grid
                            if (!isMobile) {
                                // Store all properties for later reference
                                window.initialMapProperties = allProperties;
                                
                                const propsContainer = document.getElementById('mapDesktopPropertiesContainer');
                                if (propsContainer) {
                                    propsContainer.innerHTML = '';
                                    
                                    // Add header
                                    const header = document.createElement('div');
                                    header.className = 'mb-4 pb-3 border-b border-gray-300 sticky top-0 bg-white z-10 col-span-2';
                                    header.innerHTML = `
                                        <h3 class="font-bold text-lg text-gray-800">Объекты на карте</h3>
                                        <p class="text-sm text-gray-500">${allProperties.length} объектов всего</p>
                                    `;
                                    propsContainer.appendChild(header);
                                    
                                    // Set grid layout for 2 columns
                                    propsContainer.style.display = 'grid';
                                    propsContainer.style.gridTemplateColumns = '1fr 1fr';
                                    propsContainer.style.gap = '12px';
                                    
                                    allProperties.slice(0, 20).forEach(prop => {
                                        const card = createDesktopPropertyCard(prop);
                                        propsContainer.appendChild(card);
                                    });
                                    console.log(`✅ Loaded ${Math.min(20, allProperties.length)} property cards to desktop panel (2-column grid)`);
                                    
                                    // ✅ NEW: Initialize infinite scroll for left panel
                                    currentDisplayOffset = Math.min(20, allProperties.length);
                                    setTimeout(() => {
                                        initInfiniteScroll();
                                    }, 100);
                                }
                            }
                            
                            // Store all properties for filtering and reference
                            window.mapAllProperties = allProperties;
                            window.mapInitialProperties = [...allProperties];
                            
                            // Group properties by coordinates
                            const grouped = groupPropertiesByCoords(allProperties);
                            console.log(`📊 Grouped ${allProperties.length} properties into ${grouped.length} location groups`);
                            
                            // Create function to render markers based on current properties
                            const renderMapMarkers = (propertiesToRender) => {
                                fullscreenMapInstance.geoObjects.removeAll();
                                
                                // Re-group by coordinates
                                const groupedToRender = groupPropertiesByCoords(propertiesToRender);
                                
                                // Create enhanced placemarks
                                groupedToRender.forEach(group => {
                                    try {
                                        const placemark = createEnhancedYandexMarker(group.properties);
                                        fullscreenMapInstance.geoObjects.add(placemark);
                                    } catch (error) {
                                        console.error('❌ Error creating marker:', error, group);
                                    }
                                });
                                
                                console.log(`✅ Rendered ${groupedToRender.length} markers on fullscreen map (${propertiesToRender.length} properties)`);
                                return groupedToRender;
                            };
                            
                            // Render initial markers
                            let currentGrouped = renderMapMarkers(allProperties);
                            window.mapGroupedProperties = currentGrouped;
                            
                            // ⚠️ CRITICAL: NEVER AUTO-CENTER ON ALL PROPERTIES
                            // Map STAYS centered on current city (from meta tags)
                            // NEVER call setBounds or setCenter - keep exact city view
                            console.log(`🗺️ Map stays on city: center=${cityCoordinates}, zoom=${cityZoom}`);
                            
                            // Add zoom listener for MULTI-CITY support
                            let zoomTimeout;
                            let lastLoadedZoom = null;
                            let isLoadingAllCities = false;
                            
                            fullscreenMapInstance.events.add('boundschange', function(e) {
                                clearTimeout(zoomTimeout);
                                zoomTimeout = setTimeout(() => {
                                    const currentZoom = fullscreenMapInstance.getZoom();
                                    console.log(`🔍 Map zoom level: ${currentZoom}`);
                                    
                                    // 🌍 MULTI-CITY: When zoomed out far (zoom <= 6), load ALL cities
                                    const shouldLoadAllCities = currentZoom <= 6;
                                    
                                    if (shouldLoadAllCities && !isLoadingAllCities && lastLoadedZoom !== 'all') {
                                        console.log('🌍 ZOOM OUT DETECTED: Loading properties from ALL CITIES...');
                                        isLoadingAllCities = true;
                                        lastLoadedZoom = 'all';
                                        
                                        // Load ALL cities properties (no city_id)
                                        const fetchAllCitiesProperties = async () => {
                                            let allProperties = [];
                                            let page = 1;
                                            let totalPages = 1;
                                            
                                            do {
                                                try {
                                                    const response = await fetch(`/api/map-properties?per_page=500&page=${page}`);
                                                    const data = await response.json();
                                                    
                                                    if (!data.success || !data.properties) break;
                                                    
                                                    allProperties = allProperties.concat(data.properties);
                                                    totalPages = data.pagination?.pages || 1;
                                                    page++;
                                                    
                                                    console.log(`📥 ALL CITIES: Fetched page ${page-1}/${totalPages}, total: ${allProperties.length}`);
                                                } catch(err) {
                                                    console.error('❌ Error loading all cities:', err);
                                                    break;
                                                }
                                            } while (page <= totalPages);
                                            
                                            return allProperties;
                                        };
                                        
                                        fetchAllCitiesProperties().then(allProperties => {
                                            if (allProperties.length > 0) {
                                                console.log(`✅ Loaded ${allProperties.length} properties from ALL CITIES`);
                                                window.mapAllProperties = allProperties;
                                                
                                                // Re-render markers with all cities
                                                const grouped = groupPropertiesByCoords(allProperties);
                                                fullscreenMapInstance.geoObjects.removeAll();
                                                
                                                grouped.forEach(group => {
                                                    try {
                                                        const placemark = createEnhancedYandexMarker(group.properties);
                                                        fullscreenMapInstance.geoObjects.add(placemark);
                                                    } catch(error) {
                                                        console.error('❌ Error creating marker:', error);
                                                    }
                                                });
                                                
                                                console.log(`✅ Rendered ${grouped.length} markers from ALL CITIES`);
                                            }
                                            isLoadingAllCities = false;
                                        });
                                    } 
                                    // When zoomed in (zoom > 6), go back to current city
                                    else if (!shouldLoadAllCities && lastLoadedZoom === 'all' && !isLoadingAllCities) {
                                        console.log('🏙️ ZOOM IN DETECTED: Going back to current city properties...');
                                        lastLoadedZoom = null;
                                        
                                        // Re-load current city properties
                                        if (window.mapInitialProperties && window.mapInitialProperties.length > 0) {
                                            const grouped = groupPropertiesByCoords(window.mapInitialProperties);
                                            fullscreenMapInstance.geoObjects.removeAll();
                                            
                                            grouped.forEach(group => {
                                                try {
                                                    const placemark = createEnhancedYandexMarker(group.properties);
                                                    fullscreenMapInstance.geoObjects.add(placemark);
                                                } catch(error) {
                                                    console.error('❌ Error creating marker:', error);
                                                }
                                            });
                                            
                                            console.log(`✅ Back to ${grouped.length} markers in current city`);
                                        }
                                    }
                                }, 500);
                            });
                            
                            // ✅ NEW: Initialize viewport listener for dynamic updates when map moves
                            setTimeout(() => {
                                initMapViewportListener();
                            }, 100);
                        });
                })
                .catch(error => {
                    console.error('❌ Error loading properties for fullscreen map:', error);
                });
            
            console.log('✅ Fullscreen Yandex Map initialized');
        } catch (error) {
            console.error('❌ Error initializing fullscreen map:', error);
        }
    });
}

// Open property bottom sheet (Mobile)
function openPropertyBottomSheet(properties) {
    const bottomSheet = document.getElementById('propertyBottomSheet');
    const backdrop = document.getElementById('bottomSheetBackdrop');
    const container = document.getElementById('bottomSheetPropertiesContainer');
    
    if (!bottomSheet || !backdrop || !container) {
        console.warn('⚠️ Bottom sheet elements not found');
        return;
    }
    
    console.log(`🗺️ Opening bottom sheet with ${properties.length} properties`);
    
    // Clear previous content
    container.innerHTML = '';
    
    // Create property cards
    properties.forEach((property, index) => {
        const card = createPropertyCard(property, index);
        container.appendChild(card);
    });
    
    // Show bottom sheet with animation
    backdrop.classList.remove('hidden');
    bottomSheet.classList.remove('hidden');
    
    // Trigger animation after a brief delay for smooth transition
    setTimeout(() => {
        backdrop.classList.add('active');
        bottomSheet.classList.add('active');
    }, 10);
}

// Close property bottom sheet
function closePropertyBottomSheet() {
    const bottomSheet = document.getElementById('propertyBottomSheet');
    const backdrop = document.getElementById('bottomSheetBackdrop');
    
    if (!bottomSheet || !backdrop) return;
    
    // Remove active classes to trigger close animation
    backdrop.classList.remove('active');
    bottomSheet.classList.remove('active');
    
    // Hide elements after animation completes
    setTimeout(() => {
        backdrop.classList.add('hidden');
        bottomSheet.classList.add('hidden');
    }, 300);
}

// Create property card for bottom sheet
function createPropertyCard(property, index) {
    const card = document.createElement('div');
    card.className = 'bottom-sheet-property-card bg-white rounded-xl shadow-md overflow-hidden';
    
    const price = formatPrice(property.price);
    const rooms = property.rooms !== undefined && property.rooms !== null ? property.rooms : (property.room_count !== undefined && property.room_count !== null ? property.room_count : null);
    const area = property.area || property.total_area || '?';
    const complex = property.residential_complex || property.complex_name || 'Жилой комплекс';
    const image = property.main_image || property.image || 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
    const cashback = property.cashback_rate || 0;
    // ✅ ИСПРАВЛЕНО: Property URL generation with proper format
    const propertyUrl = property.url || (window.CURRENT_CITY_SLUG ? `/${window.CURRENT_CITY_SLUG}/object/${property.id}` : `/object/${property.id}`);
    
    // Format rooms text - handle studios properly
    let roomsText = '?-комн.';
    if (rooms === 0 || rooms === '0') {
        roomsText = 'Студия';
    } else if (rooms !== null && rooms !== '?' && rooms !== '') {
        roomsText = rooms + '-комн.';
    }
    
    // Create image element and handle error via JavaScript (no inline onerror)
    const imgElement = document.createElement('img');
    imgElement.src = image;
    imgElement.alt = complex;
    imgElement.className = 'w-full h-32 object-cover';
    imgElement.addEventListener('error', function() {
        this.src = 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
    });
    
    card.innerHTML = `
        <a href="${propertyUrl}" style="display: block; text-decoration: none; color: inherit;" class="flex gap-3 h-full">
            <div class="relative w-32 flex-shrink-0">
                <div class="img-container"></div>
                ${cashback > 0 ? `
                    <div class="absolute top-1 left-1 bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-2 py-0.5 rounded text-xs font-bold shadow">
                        ${cashback}%
                    </div>
                ` : ''}
            </div>
            <div class="flex-1 py-2 pr-2">
                <div class="text-lg font-bold text-blue-600 mb-1">${price}</div>
                <div class="text-gray-700 text-sm font-medium mb-1">
                    ${roomsText}, ${area} м²
                </div>
                <div class="text-xs text-gray-500 mb-1">${complex}</div>
                <div class="text-xs text-gray-400">
                    ${property.floor ? `Этаж ${property.floor}` : ''}
                </div>
            </div>
        </a>
    `;
    
    // Insert image via JavaScript
    const imgContainer = card.querySelector('.img-container');
    if (imgContainer) {
        imgContainer.appendChild(imgElement);
    }
    
    return card;
}

// Global map for property ID to marker placemark
window.propertyIdToMarker = {};

// Create desktop property card for 2-column modal (beautiful like /map page)
function createDesktopPropertyCard(property) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-md transition-all duration-300 border border-gray-200 cursor-pointer flex flex-col';
    card.setAttribute('data-property-card-id', property.id);
    card.setAttribute('data-property-id', property.id);
    
    // Add hover to highlight marker on map + VISUAL FEEDBACK
    card.addEventListener('mouseenter', () => {
        // 🎨 VISUAL FEEDBACK: Highlight the card itself
        card.style.backgroundColor = '#f0f9ff';  // Light blue background
        card.style.borderColor = '#0088CC';      // Brand blue border
        card.style.borderWidth = '2px';
        card.style.boxShadow = '0 10px 25px -5px rgba(0, 136, 204, 0.2)';
        
        // 🎯 Highlight marker on map using propertyIdToMarkerMap
        // 🎨 КРАСИВЫЙ ЭФФЕКТ: Показываем красивую карточку с фотографией на маркере
        if (window.propertyIdToMarkerMap && window.propertyIdToMarkerMap[property.id]) {
            const markers = window.propertyIdToMarkerMap[property.id];
            console.log(`🎯 Card hover: Found ${markers.length} marker(s) for property ${property.id}`);
            markers.forEach((marker, idx) => {
                if (marker.geometry) {
                    const rooms = property.rooms !== undefined && property.rooms !== null ? property.rooms : '?';
                    const price = formatPrice(property.price);
                    
                    // Получить изображение безопасно
                    let image = 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=300&q=80';
                    if (property.main_image && property.main_image !== '/static/images/no-photo.jpg') {
                        image = property.main_image;
                    } else if (property.gallery_images) {
                        try {
                            const imgs = Array.isArray(property.gallery_images) ? property.gallery_images : JSON.parse(property.gallery_images);
                            if (imgs.length > 1) image = imgs[1];  // 2-е фото (1-е всегда планировка)
                            else if (imgs.length > 0) image = imgs[0];
                        } catch(e) {}
                    }
                    
                    // 🎨 Создаем красивую карточку с фотографией
                    const hoverCardHTML = `
                        <div style="
                            background: white;
                            border-radius: 8px;
                            overflow: hidden;
                            box-shadow: 0 8px 16px rgba(0,0,0,0.2);
                            width: 160px;
                            font-family: Inter, sans-serif;
                            border: 2px solid #0088CC;
                        ">
                            <div style="position: relative; height: 80px; overflow: hidden;">
                                <img src="${image}" style="width: 100%; height: 100%; object-fit: cover;" alt="property">
                            </div>
                            <div style="padding: 8px 10px;">
                                <div style="font-weight: bold; font-size: 14px; color: #0088CC; margin-bottom: 2px;">${price}</div>
                                <div style="font-size: 12px; color: #64748b;">${rooms === 0 ? 'Студия' : rooms + '-комн.'}</div>
                            </div>
                        </div>
                    `;
                    
                    // Меняем iconLayout на карточку
                    const hoverLayout = ymaps.templateLayoutFactory.createClass(hoverCardHTML);
                    marker.options.set('iconLayout', hoverLayout);
                    
                    // Сохраняем информацию что это highlighted
                    marker._isHighlighted = true;
                    
                    console.log(`🎯 Marker ${idx + 1} highlighted (BEAUTIFUL PHOTO CARD ✨)`);
                }
            });
        } else {
            console.warn(`⚠️ No marker found for property ${property.id}`);
        }
    });
    
    card.addEventListener('mouseleave', () => {
        // 🎨 RESET: Remove highlight from card
        card.style.backgroundColor = '';
        card.style.borderColor = '';
        card.style.borderWidth = '';
        card.style.boxShadow = '';
        
        // 🎯 Reset marker highlight using propertyIdToMarkerMap
        if (window.propertyIdToMarkerMap && window.propertyIdToMarkerMap[property.id]) {
            const markers = window.propertyIdToMarkerMap[property.id];
            markers.forEach(marker => {
                // 🎨 Восстанавливаем оригинальный layout
                if (marker._originalIconLayout) {
                    marker.options.set('iconLayout', marker._originalIconLayout);
                    marker._isHighlighted = false;
                    console.log(`🎯 Marker reset to original layout`);
                }
            });
        }
    });
    
    // Price
    const price = formatPrice(property.price);
    
    // Rooms handling
    const rooms = property.rooms !== undefined && property.rooms !== null ? property.rooms : (property.room_count !== undefined && property.room_count !== null ? property.room_count : null);
    let roomText = '?-комн.';
    if (rooms === 0 || rooms === '0') {
        roomText = 'Студия';
    } else if (rooms !== null && rooms !== '?' && rooms !== '') {
        roomText = rooms + ' комнаты';
    }
    
    // Area
    const area = property.area || property.total_area || '?';
    
    // Floor info
    const apartmentFloor = property.floor || 0;
    const buildingFloors = property.total_floors || 0;
    let floorText = '';
    if (apartmentFloor > 0 && buildingFloors > 0) {
        floorText = `${apartmentFloor}/${buildingFloors} эт.`;
    } else if (apartmentFloor > 0) {
        floorText = `${apartmentFloor} эт.`;
    }
    
    // Developer
    const developer = property.developer_name || property.developer || '';
    
    // Parse gallery images
    let firstImage = 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
    let imageCount = 0;
    let allImages = [];
    
    if (property.gallery_images || property.gallery) {
        const galleryData = property.gallery_images || property.gallery;
        try {
            if (Array.isArray(galleryData)) {
                allImages = galleryData;
            } else {
                allImages = JSON.parse(galleryData);
            }
            if (allImages.length > 0) {
                firstImage = allImages[0];
                imageCount = allImages.length;
            }
        } catch(e) {
            allImages = [galleryData];
            firstImage = galleryData;
            imageCount = 1;
        }
    }
    
    if (imageCount === 0 && property.main_image && property.main_image !== '/static/images/no-photo.jpg') {
        try {
            const images = JSON.parse(property.main_image);
            if (Array.isArray(images) && images.length > 0) {
                allImages = images;
                firstImage = images[0];
                imageCount = images.length;
            }
        } catch(e) {
            allImages = [property.main_image];
            firstImage = property.main_image;
            imageCount = 1;
        }
    }
    
    if (imageCount === 0 && property.image) {
        allImages = [property.image];
        firstImage = property.image;
        imageCount = 1;
    }
    
    // Cashback - use direct amount from API or calculate from rate
    const cashbackRate = property.cashback_rate || 0;
    const cashbackAmount = property.cashback || (property.price && cashbackRate > 0 ? Math.round(property.price * cashbackRate / 100) : 0);
    const cashbackFormatted = cashbackAmount > 0 ? cashbackAmount.toLocaleString('ru-RU') : '';
    
    // Store images for slider
    card.imageData = allImages;
    
    const propertyUrl = property.url || (window.CURRENT_CITY_SLUG ? `/${window.CURRENT_CITY_SLUG}/object/${property.id}` : `/object/${property.id}`);
    
    card.innerHTML = `
        <a href="${propertyUrl}" style="display: block; text-decoration: none; color: inherit; height: 100%;" class="flex flex-col h-full">
        <div class="relative image-slider-container bg-gray-200 overflow-hidden" style="height: 180px; max-height: 180px;" onmouseenter="startImageSlider(this)" onmouseleave="stopImageSlider(this)" onclick="nextSliderImage(this)">
            <img alt="${property.residential_complex}" class="w-full h-full object-cover object-center main-image cursor-pointer transition-all duration-300" src="${firstImage}" style="height: 180px; max-height: 180px;" onerror="this.src='https://images.unsplash.com/photo-1560448204-603b3fc33ddc?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';"/>
            ${cashbackAmount > 0 ? `<div class="absolute top-2 right-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-2 py-1 rounded-full text-xs font-bold shadow-md pointer-events-none">${cashbackFormatted} ₽</div>` : ''}
            ${imageCount > 1 ? `<div class="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full pointer-events-none font-medium">${imageCount} фото</div>` : ''}
            ${imageCount > 1 ? `<div class="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded hidden slider-indicator pointer-events-none">1/${imageCount}</div>` : ''}
            ${imageCount > 1 ? `<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white w-8 h-8 rounded-full flex items-center justify-center cursor-pointer pointer-events-none transition-colors">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"/>
                </svg>
            </div>` : ''}
        </div>
        <div class="p-3 flex-1 flex flex-col">
            <div class="mb-2">
                <div class="text-lg font-bold text-[#0088CC]">${price}</div>
                ${cashbackAmount > 0 ? `<div class="flex items-center gap-1 mt-1">
                    <span class="inline-flex items-center bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full shadow-sm">
                        <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z"></path></svg>
                        Кэшбек ${cashbackFormatted} ₽
                    </span>
                </div>` : ''}
                <div class="text-xs text-gray-500 mt-1">${roomText}${area ? ', ' + area + ' м²' : ''}${floorText ? ', ' + floorText : ''}</div>
            </div>
            <div class="flex-1">
                <p class="text-sm font-semibold text-gray-800 line-clamp-2">${property.residential_complex || property.complex_name || 'Жилой комплекс'}</p>
                ${developer ? `<p class="text-xs text-gray-500 mt-0.5">${developer}</p>` : ''}
            </div>
        </div>
    `;
    
    // Add hover handler to highlight card AND marker on map
    card.addEventListener('mouseenter', function() {
        // Highlight this card with visual feedback
        card.classList.add('highlighted-card');
        card.style.boxShadow = '0 8px 16px rgba(0, 136, 204, 0.3)';
        card.style.transform = 'scale(1.02)';
        
        // 🗺️ ALSO HIGHLIGHT MARKER ON MAP - for custom HTML markers
        if (window.propertyIdToMarkerMap) {
            const markers = window.propertyIdToMarkerMap[property.id];
            if (markers && markers.length > 0) {
                markers.forEach(marker => {
                    try {
                        // For Yandex custom layouts, getOverlay() returns the DOM element directly
                        const overlay = marker.getOverlay();
                        if (overlay && overlay.style) {
                            overlay.style.zIndex = '1000';
                            overlay.style.filter = 'drop-shadow(0 0 8px rgba(255, 50, 50, 0.8)) brightness(1.3)';
                            overlay.style.transform = 'scale(1.2)';
                            overlay.style.transition = 'all 0.2s ease';
                        }
                    } catch (e) {
                        // Silently continue - marker might not be accessible
                    }
                });
            }
        }
    });
    
    card.addEventListener('mouseleave', function() {
        // Remove highlight from card
        card.classList.remove('highlighted-card');
        card.style.boxShadow = '';
        card.style.transform = '';
        
        // 🗺️ REMOVE MARKER HIGHLIGHT
        if (window.propertyIdToMarkerMap) {
            const markers = window.propertyIdToMarkerMap[property.id];
            if (markers && markers.length > 0) {
                markers.forEach(marker => {
                    try {
                        const overlay = marker.getOverlay();
                        if (overlay && overlay.style) {
                            overlay.style.zIndex = '100';
                            overlay.style.filter = '';
                            overlay.style.transform = '';
                            overlay.style.transition = '';
                        }
                    } catch (e) {
                        // Silently continue - marker might not be accessible
                    }
                });
            }
        }
    });
    
    return card;
}

// Handle map click - always opens fullscreen modal map
function handleMapClick(event) {
    if (event) event.stopPropagation();
    openFullscreenMap();
}

// ESC key handler for modal
function handleEscKey(event) {
    if (event.key === 'Escape' || event.keyCode === 27) {
        const modal = document.getElementById('fullscreenMapModal');
        if (modal && !modal.classList.contains('hidden')) {
            closeFullscreenMap();
        }
    }
}

// Add ESC key listener on load
document.addEventListener('keydown', handleEscKey);

// Desktop filter functions
function toggleQuickRoomFilter(room) {
    const index = mapFilters.rooms.indexOf(room);
    if (index > -1) {
        mapFilters.rooms.splice(index, 1);
    } else {
        mapFilters.rooms.push(room);
    }
    updateMapWithFilters();  // ✅ Update map when filter changes
    updateQuickRoomChips();
}
    // ✅ Display active filters
    if (typeof displayMapActiveFilters === 'function') displayMapActiveFilters();

function updateQuickRoomChips() {
    document.querySelectorAll('[data-quick-room]').forEach(chip => {
        const room = parseInt(chip.dataset.quickRoom);
        if (mapFilters.rooms.includes(room)) {
            chip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.remove('border-gray-300');
        } else {
            chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.add('border-gray-300');
        }
    });
}

function applyMapDesktopFilters() {
    mapFilters.price_min = document.getElementById('mapDesktopPriceFrom')?.value || '';
    mapFilters.price_max = document.getElementById('mapDesktopPriceTo')?.value || '';
    console.log('🗺️ Desktop filters applied:', mapFilters);
}

function resetMapAdvancedFilters() {
    mapFilters.rooms = [];
    mapFilters.price_min = '';
    mapFilters.price_max = '';
    mapFilters.area_min = '';
    mapFilters.area_max = '';
    mapFilters.floor_min = '';
    mapFilters.floor_max = '';
    mapFilters.completion = [];
    mapFilters.object_classes = [];
    
    // Clear all input fields
    document.getElementById('mapDesktopPriceFrom').value = '';
    document.getElementById('mapDesktopPriceTo').value = '';
    document.getElementById('mapAreaFrom').value = '';
    document.getElementById('mapAreaTo').value = '';
    document.getElementById('mapFloorFrom').value = '';
    document.getElementById('mapFloorTo').value = '';
    
    // Uncheck all checkboxes
    document.querySelectorAll('[data-map-filter]').forEach(el => {
        el.checked = false;
    });
    
    updateQuickRoomChips();
    console.log('🗺️ Filters reset - ALL');
    
    // ✅ КРИТИЧНО: Обновить карту и вернуться к исходным свойствам!
    if (typeof updateMapWithFilters === 'function') {
        updateMapWithFilters();
    }
}

// Load districts into desktop filter panel
function loadMapDesktopDistricts() {
    const container = document.getElementById('mapDesktopDistrictsContainer');
    if (!container) return;
    
    fetch(`/api/districts/1`)
        .then(r => r.json())
        .then(data => {
            if (data.success && data.districts) {
                container.innerHTML = data.districts.map(d => `
                    <label class="flex items-center hover:bg-gray-50 p-2 rounded-lg cursor-pointer">
                        <input type="checkbox" value="${d.id}" data-map-filter="district" 
                               class="text-blue-600 focus:ring-blue-500 border-gray-300 rounded">
                        <span class="ml-2 text-sm text-gray-700">${d.name}</span>
                    </label>
                `).join('');
                console.log(`✅ Loaded ${data.districts.length} districts for map filters`);
            }
        })
        .catch(e => console.warn('⚠️ Failed to load map districts:', e));
}

// Load developers into desktop filter panel
function loadMapDevelopers() {
    const container = document.getElementById('mapDesktopDevelopersContainer');
    if (!container) return;
    
    fetch(`/api/developers?city_id=1`)
        .then(r => r.json())
        .then(data => {
            if (data.success && data.developers) {
                container.innerHTML = data.developers.map(d => `
                    <label class="flex items-center hover:bg-gray-50 p-2 rounded-lg cursor-pointer">
                        <input type="checkbox" value="${d.id}" data-map-filter="developer" 
                               class="text-blue-600 focus:ring-blue-500 border-gray-300 rounded">
                        <span class="ml-2 text-sm text-gray-700">${d.name}</span>
                    </label>
                `).join('');
                console.log(`✅ Loaded ${data.developers.length} developers for map filters`);
            }
        })
        .catch(e => console.warn('⚠️ Failed to load map developers:', e));
}

// Open advanced filters modal/panel for map (Mobile sheet + Desktop side panel)
function openMapAdvancedFiltersFromQuick() {
    const modal = document.getElementById('mapAdvancedFiltersModal');
    if (modal) {
        modal.classList.remove('hidden');
        // Only hide body overflow on mobile (not desktop side panel)
        if (window.innerWidth < 1024) {
            document.body.style.overflow = 'hidden';
        }
    }
    closeMapQuickFilters();
}

// Also bind to direct open button for desktop
function openMapAdvancedFilters() {
    openMapAdvancedFiltersFromQuick();
}

// Close advanced filters modal/panel for map
function closeMapAdvancedFilters() {
    const modal = document.getElementById('mapAdvancedFiltersModal');
    if (modal) {
        modal.classList.add('hidden');
        // Restore body overflow only if it was mobile
        if (window.innerWidth < 1024) {
            document.body.style.overflow = '';
        }
    }
}

// Apply advanced filters from modal/panel
function applyMapAdvancedFilters() {
    // ✅ Read price filters
    mapFilters.price_min = document.getElementById('mapPriceFrom')?.value || '';
    mapFilters.price_max = document.getElementById('mapPriceTo')?.value || '';
    
    // ✅ Read area filters
    mapFilters.area_min = document.getElementById('mapAreaFrom')?.value || '';
    mapFilters.area_max = document.getElementById('mapAreaTo')?.value || '';
    
    // ✅ Read floor filters
    mapFilters.floor_min = document.getElementById('mapFloorFrom')?.value || '';
    mapFilters.floor_max = document.getElementById('mapFloorTo')?.value || '';
    
    // ✅ Read building floors filters
    mapFilters.building_floors_min = document.getElementById('mapBuildingFloorsFrom')?.value || '';
    mapFilters.building_floors_max = document.getElementById('mapBuildingFloorsTo')?.value || '';
    
    // ✅ Read build year filters
    mapFilters.build_year_min = document.getElementById('mapBuildYearFrom')?.value || '';
    mapFilters.build_year_max = document.getElementById('mapBuildYearTo')?.value || '';
    
    // ✅ Clear and repopulate completion filter
    mapFilters.completion = [];
    document.querySelectorAll('[data-map-filter="completion"]').forEach(el => {
        if (el.checked) {
            mapFilters.completion.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate object_classes filter
    mapFilters.object_classes = [];
    document.querySelectorAll('[data-map-filter="object_class"]').forEach(el => {
        if (el.checked) {
            mapFilters.object_classes.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate building_status filter
    mapFilters.building_status = [];
    document.querySelectorAll('[data-map-filter="building_status"]').forEach(el => {
        if (el.checked) {
            mapFilters.building_status.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate features filter
    mapFilters.features = [];
    document.querySelectorAll('[data-map-filter="features"]').forEach(el => {
        if (el.checked) {
            mapFilters.features.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate building_released filter
    mapFilters.building_released = [];
    document.querySelectorAll('[data-map-filter="building_released"]').forEach(el => {
        if (el.checked) {
            mapFilters.building_released.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate floor_options filter
    mapFilters.floor_options = [];
    document.querySelectorAll('[data-map-filter="floor_options"]').forEach(el => {
        if (el.checked) {
            mapFilters.floor_options.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate renovation filter
    mapFilters.renovation = [];
    document.querySelectorAll('[data-map-filter="renovation"]').forEach(el => {
        if (el.checked) {
            mapFilters.renovation.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate districts filter
    mapFilters.districts = [];
    document.querySelectorAll('[data-map-filter="district"]').forEach(el => {
        if (el.checked) {
            mapFilters.districts.push(el.value);
        }
    });
    
    // ✅ Clear and repopulate developers filter
    mapFilters.developers = [];
    document.querySelectorAll('[data-map-filter="developer"]').forEach(el => {
        if (el.checked) {
            mapFilters.developers.push(el.value);
        }
    });
    
    console.log('🗺️ All advanced filters applied:', mapFilters);
    
    // Update map with new filters
    if (typeof updateMapWithFilters === 'function') {
        updateMapWithFilters();
    }
    
    // ✅ Display active filters
    if (typeof displayMapActiveFilters === 'function') {
        displayMapActiveFilters();
    }
    
    // Close modal/panel
    closeMapAdvancedFilters();
}

// Make functions globally available
window.openFullscreenMap = openFullscreenMap;
window.closeFullscreenMap = closeFullscreenMap;
window.handleMapClick = handleMapClick;
window.closePropertyBottomSheet = closePropertyBottomSheet;
window.toggleQuickRoomFilter = toggleQuickRoomFilter;
window.applyMapDesktopFilters = applyMapDesktopFilters;
window.resetMapAdvancedFilters = resetMapAdvancedFilters;
window.createDesktopPropertyCard = createDesktopPropertyCard;
window.loadMapDesktopDistricts = loadMapDesktopDistricts;
window.loadMapDevelopers = loadMapDevelopers;
window.openMapAdvancedFiltersFromQuick = openMapAdvancedFiltersFromQuick;
window.closeMapAdvancedFilters = closeMapAdvancedFilters;
window.applyMapAdvancedFilters = applyMapAdvancedFilters;
window.openMapQuickFilters = openMapQuickFilters;
window.closeMapQuickFilters = closeMapQuickFilters;
window.toggleToolbarRoomFilter = toggleToolbarRoomFilter;
window.applyQuickFilters = applyQuickFilters;
window.resetQuickFilters = resetQuickFilters;
window.syncQuickFiltersFromState = syncQuickFiltersFromState;
window.toggleMapDevelopersList = toggleMapDevelopersList;

// Initialize mini map on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('🗺️ Properties mini map - DOMContentLoaded');
        setTimeout(initMiniPropertiesMap, 500);
    });
} else {
    console.log('🗺️ Properties mini map - DOM already loaded');
    setTimeout(initMiniPropertiesMap, 500);
}

// ==================== MAP FILTERS FUNCTIONALITY ====================

// Filter state management - ГЛОБАЛЬНАЯ переменная для доступа из других скриптов
window.mapFilters = {
    // Quick filters
    rooms: [],
    
    // Price range
    price_min: '',
    price_max: '',
    
    // Area range
    area_min: '',
    area_max: '',
    
    // Floor range
    floor_min: '',
    floor_max: '',
    
    // Building floors range
    building_floors_min: '',
    building_floors_max: '',
    
    // Build year range
    build_year_min: '',
    build_year_max: '',
    
    // Multi-select filters
    developers: [],
    districts: [],
    completion: [],
    object_classes: [],
    building_status: [],
    features: [],
    building_released: [],
    floor_options: [],
    renovation: []
};
const mapFilters = window.mapFilters;

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Toggle room filter chip
function toggleMapRoomFilter(room) {
    const index = mapFilters.rooms.indexOf(room);
    const chip = document.querySelector(`button[data-map-room-filter="${room}"]`);
    
    if (index > -1) {
        // Remove filter
        mapFilters.rooms.splice(index, 1);
        if (chip) {
            chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.add('border-gray-300');
        }
    } else {
        // Add filter
        mapFilters.rooms.push(room);
        if (chip) {
            chip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.remove('border-gray-300');
        }
    }
    
    // CRITICAL: UPDATE MAP WITH NEW FILTERS!
    console.log('🗺️ Room filter applied, updating map with rooms:', mapFilters.rooms);
    updateMapWithFilters();
}

// Open advanced filters modal
function openMapAdvancedFilters() {
    const modal = document.getElementById('mapAdvancedFiltersModal');
    console.log('🗺️ openMapAdvancedFilters called, modal:', modal ? 'FOUND' : 'NOT FOUND');
    if (modal) {
        // Удаляю ВСЕ скрывающие классы и стили
        modal.classList.remove('hidden');
        modal.style.display = 'block';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
        modal.style.zIndex = '9999';
        document.body.style.overflow = 'hidden';
        console.log('✅ Advanced filters modal OPENED');
    } else {
        console.error('❌ mapAdvancedFiltersModal NOT FOUND!');
    }
}

// Close advanced filters modal
function closeMapAdvancedFilters() {
    const modal = document.getElementById('mapAdvancedFiltersModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
        document.body.style.overflow = '';
        console.log('🗺️ Advanced filters modal closed');
    }
}

// Toggle developers list (collapsible)
function toggleMapDevelopersList() {
    const list = document.getElementById('mapDevelopersList');
    const chevron = document.getElementById('mapDevelopersChevron');
    if (list && chevron) {
        list.classList.toggle('hidden');
        chevron.classList.toggle('rotate-180');
    }
}

// === TOOLBAR QUICK FILTERS ===

// Toggle room filter on toolbar
function toggleToolbarRoomFilter(room) {
    const index = mapFilters.rooms.indexOf(room);
    const chip = document.querySelector(`button[data-toolbar-room="${room}"]`);
    
    if (index > -1) {
        // Remove filter
        mapFilters.rooms.splice(index, 1);
        if (chip) {
            chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.add('border-gray-300');
        }
    } else {
        // Add filter
        mapFilters.rooms.push(room);
        if (chip) {
            chip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.remove('border-gray-300');
        }
    }
    
    console.log('🗺️ Toolbar room filter toggled:', room, 'Current rooms:', mapFilters.rooms);
    
    // Sync with bottom sheet chips
    syncToolbarFiltersWithBottomSheet();
    
    // Update map badge counter
    updateMapFiltersBadge();
    
    // Update map immediately
    updateMapWithFilters();
}

// Sync toolbar filters with bottom sheet
function syncToolbarFiltersWithBottomSheet() {
    // Sync room chips in bottom sheet
    document.querySelectorAll('[data-quick-room]').forEach(chip => {
        const room = parseInt(chip.dataset.quickRoom);
        const toolbarChip = document.querySelector(`button[data-toolbar-room="${room}"]`);
        
        if (mapFilters.rooms.includes(room)) {
            chip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.remove('border-gray-300');
            if (toolbarChip) {
                toolbarChip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                toolbarChip.classList.remove('border-gray-300');
            }
        } else {
            chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.add('border-gray-300');
            if (toolbarChip) {
                toolbarChip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                toolbarChip.classList.add('border-gray-300');
            }
        }
    });
}

// === QUICK FILTERS BOTTOM SHEET ===

// Open quick filters bottom sheet
function openMapQuickFilters() {
    const backdrop = document.getElementById('mapQuickFiltersBackdrop');
    const sheet = document.getElementById('mapQuickFiltersSheet');
    
    if (backdrop && sheet) {
        // Show elements
        backdrop.classList.remove('hidden');
        sheet.classList.remove('hidden');
        
        // Trigger animations
        setTimeout(() => {
            backdrop.style.opacity = '1';
            sheet.style.transform = 'translateY(0)';
        }, 10);
        
        // Sync values from mapFilters to quick filters UI
        syncQuickFiltersFromState();
        
        console.log('🗺️ Quick filters bottom sheet opened');
    }
}

// Close quick filters bottom sheet
function closeMapQuickFilters() {
    const backdrop = document.getElementById('mapQuickFiltersBackdrop');
    const sheet = document.getElementById('mapQuickFiltersSheet');
    
    if (backdrop && sheet) {
        backdrop.style.opacity = '0';
        sheet.style.transform = 'translateY(100%)';
        
        setTimeout(() => {
            backdrop.classList.add('hidden');
            sheet.classList.add('hidden');
        }, 300);
        
        console.log('🗺️ Quick filters bottom sheet closed');
    }
}

// Toggle room filter in quick filters
function toggleQuickRoomFilter(room) {
    const index = mapFilters.rooms.indexOf(room);
    const chip = document.querySelector(`button[data-quick-room="${room}"]`);
    
    if (index > -1) {
        // Remove filter
        mapFilters.rooms.splice(index, 1);
        if (chip) {
            chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.add('border-gray-300');
        }
    } else {
        // Add filter
        mapFilters.rooms.push(room);
        if (chip) {
            chip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.remove('border-gray-300');
        }
    }
    
    console.log('🗺️ Quick room filter toggled:', room, 'Current rooms:', mapFilters.rooms);
    console.log('🗺️ Calling updateMapWithFilters now...');
    if (typeof updateMapWithFilters === 'function') {
        updateMapWithFilters();
    } else {
        console.error('❌ updateMapWithFilters NOT FOUND!')
    }
    updateMapWithFilters();  // ✅ Update map after room filter change
}

// Sync quick filters UI from current filter state
function syncQuickFiltersFromState() {
    // Sync room chips in bottom sheet AND toolbar
    document.querySelectorAll('[data-quick-room], [data-toolbar-room]').forEach(chip => {
        const room = parseInt(chip.dataset.quickRoom || chip.dataset.toolbarRoom);
        if (mapFilters.rooms.includes(room)) {
            chip.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.remove('border-gray-300');
        } else {
            chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
            chip.classList.add('border-gray-300');
        }
    });
    
    // Sync price inputs
    const quickPriceFrom = document.getElementById('quickPriceFrom');
    const quickPriceTo = document.getElementById('quickPriceTo');
    if (quickPriceFrom) quickPriceFrom.value = mapFilters.price_min || '';
    if (quickPriceTo) quickPriceTo.value = mapFilters.price_max || '';
    
    // Sync area inputs
    const quickAreaFrom = document.getElementById('quickAreaFrom');
    const quickAreaTo = document.getElementById('quickAreaTo');
    if (quickAreaFrom) quickAreaFrom.value = mapFilters.area_min || '';
    if (quickAreaTo) quickAreaTo.value = mapFilters.area_max || '';
}

// Apply quick filters
function applyQuickFilters() {
    // Collect values from quick filter inputs
    mapFilters.price_min = document.getElementById('quickPriceFrom').value;
    mapFilters.price_max = document.getElementById('quickPriceTo').value;
    mapFilters.area_min = document.getElementById('quickAreaFrom').value;
    mapFilters.area_max = document.getElementById('quickAreaTo').value;
    
    console.log('🗺️ Applying quick filters:', mapFilters);
    
    // Update filters summary
    updateFiltersCount();
    
    // Update map badge counter
    updateMapFiltersBadge();
    
    // Close bottom sheet
    closeMapQuickFilters();
    
    // Update map with filters
    updateMapWithFilters();
    updateMapWithFilters();  // ✅ Update map when quick filters applied
}

// Reset quick filters
function resetQuickFilters() {
    // Clear rooms
    mapFilters.rooms = [];
    document.querySelectorAll('[data-quick-room], [data-toolbar-room]').forEach(chip => {
        chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
        chip.classList.add('border-gray-300');
    });
    
    // Clear price
    mapFilters.price_min = '';
    mapFilters.price_max = '';
    const quickPriceFrom = document.getElementById('quickPriceFrom');
    const quickPriceTo = document.getElementById('quickPriceTo');
    if (quickPriceFrom) quickPriceFrom.value = '';
    if (quickPriceTo) quickPriceTo.value = '';
    
    // Clear area
    mapFilters.area_min = '';
    mapFilters.area_max = '';
    const quickAreaFrom = document.getElementById('quickAreaFrom');
    const quickAreaTo = document.getElementById('quickAreaTo');
    if (quickAreaFrom) quickAreaFrom.value = '';
    if (quickAreaTo) quickAreaTo.value = '';
    
    console.log('🗺️ Quick filters reset');
    
    // Update map
    updateMapWithFilters();
}

// Open advanced filters from quick filters bottom sheet
function openMapAdvancedFiltersFromQuick() {
    // Close quick filters
    closeMapQuickFilters();
    
    // Wait for animation, then open advanced
    setTimeout(() => {
        openMapAdvancedFilters();
    }, 350);
}

// Update active filters count display
function updateFiltersCount() {
    let count = 0;
    
    // Count active filters
    if (mapFilters.rooms.length > 0) count++;
    if (mapFilters.price_min || mapFilters.price_max) count++;
    if (mapFilters.area_min || mapFilters.area_max) count++;
    if (mapFilters.floor_min || mapFilters.floor_max) count++;
    if (mapFilters.developers.length > 0) count++;
    if (mapFilters.completion.length > 0) count++;
    if (mapFilters.object_classes.length > 0) count++;
    
    const summaryEl = document.getElementById('mapActiveFiltersSummary');
    const countEl = document.getElementById('mapActiveFiltersCount');
    
    if (count > 0) {
        if (summaryEl) summaryEl.classList.remove('hidden');
        if (countEl) countEl.textContent = `${count} ${count === 1 ? 'фильтр' : count < 5 ? 'фильтра' : 'фильтров'}`;
    } else {
        if (summaryEl) summaryEl.classList.add('hidden');
    }
}

// Reset advanced filters (called from "Сбросить" button in advanced filters modal)
function resetMapAdvancedFilters() {
    // Clear all advanced filter inputs
    document.getElementById('mapPriceFrom').value = '';
    document.getElementById('mapPriceTo').value = '';
    document.getElementById('mapAreaFrom').value = '';
    document.getElementById('mapAreaTo').value = '';
    document.getElementById('mapFloorFrom').value = '';
    document.getElementById('mapFloorTo').value = '';
    
    // Uncheck all checkboxes
    document.querySelectorAll('[data-map-filter="developer"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-map-filter="completion"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-map-filter="object_class"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-map-filter="building_status"]').forEach(cb => cb.checked = false);
    
    // Clear filter state object - ALL filters including rooms
    Object.keys(mapFilters).forEach(key => {
        if (Array.isArray(mapFilters[key])) {
            mapFilters[key] = [];
        } else {
            mapFilters[key] = '';
        }
    });
    
    // Clear room chip styling
    document.querySelectorAll('.map-room-chip').forEach(chip => {
        chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
        chip.classList.add('border-gray-300');
    });
    
    console.log('🗺️ All filters reset (advanced + rooms)');
    
    // Close modal and update map
    closeMapAdvancedFilters();
    updateMapWithFilters();
}

// Apply advanced filters
function applyMapAdvancedFilters() {
    // Collect filter values
    mapFilters.price_min = document.getElementById('mapPriceFrom').value;
    mapFilters.price_max = document.getElementById('mapPriceTo').value;
    mapFilters.area_min = document.getElementById('mapAreaFrom').value;
    mapFilters.area_max = document.getElementById('mapAreaTo').value;
    mapFilters.floor_min = document.getElementById('mapFloorFrom').value;
    mapFilters.floor_max = document.getElementById('mapFloorTo').value;
    
    // Collect checkbox values
    mapFilters.developers = Array.from(document.querySelectorAll('[data-map-filter="developer"]:checked')).map(cb => cb.value);
    mapFilters.completion = Array.from(document.querySelectorAll('[data-map-filter="completion"]:checked')).map(cb => cb.value);
    mapFilters.object_classes = Array.from(document.querySelectorAll('[data-map-filter="object_class"]:checked')).map(cb => cb.value);
    mapFilters.building_status = Array.from(document.querySelectorAll('[data-map-filter="building_status"]:checked')).map(cb => cb.value);
    
    console.log('🗺️ Applying advanced filters:', mapFilters);
    
    // Update map badge counter
    updateMapFiltersBadge();
    
    // Close modal
    closeMapAdvancedFilters();
    
    // CRITICAL: Update map with filters!
    console.log('🗺️ Advanced filters applied, updating map...');
    updateMapWithFilters();
}

// Reset all filters
function resetMapFilters() {
    // Reset filter state
    Object.keys(mapFilters).forEach(key => {
        if (Array.isArray(mapFilters[key])) {
            mapFilters[key] = [];
        } else {
            mapFilters[key] = '';
        }
    });
    
    // Reset quick filters UI
    document.querySelectorAll('[data-quick-room]').forEach(chip => {
        chip.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
        chip.classList.add('border-gray-300');
    });
    
    const quickPriceFrom = document.getElementById('quickPriceFrom');
    const quickPriceTo = document.getElementById('quickPriceTo');
    const quickAreaFrom = document.getElementById('quickAreaFrom');
    const quickAreaTo = document.getElementById('quickAreaTo');
    
    if (quickPriceFrom) quickPriceFrom.value = '';
    if (quickPriceTo) quickPriceTo.value = '';
    if (quickAreaFrom) quickAreaFrom.value = '';
    if (quickAreaTo) quickAreaTo.value = '';
    
    // Reset advanced filters UI
    const mapPriceFrom = document.getElementById('mapPriceFrom');
    const mapPriceTo = document.getElementById('mapPriceTo');
    const mapAreaFrom = document.getElementById('mapAreaFrom');
    const mapAreaTo = document.getElementById('mapAreaTo');
    const mapFloorFrom = document.getElementById('mapFloorFrom');
    const mapFloorTo = document.getElementById('mapFloorTo');
    
    if (mapPriceFrom) mapPriceFrom.value = '';
    if (mapPriceTo) mapPriceTo.value = '';
    if (mapAreaFrom) mapAreaFrom.value = '';
    if (mapAreaTo) mapAreaTo.value = '';
    if (mapFloorFrom) mapFloorFrom.value = '';
    if (mapFloorTo) mapFloorTo.value = '';
    
    document.querySelectorAll('[data-map-filter="developer"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-map-filter="completion"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-map-filter="object_class"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-map-filter="building_status"]').forEach(cb => cb.checked = false);
    
    // Update filters count
    updateFiltersCount();
    
    // Update map badge counter (reset to 0)
    updateMapFiltersBadge();
    
    console.log('🗺️ All filters reset');
    updateMapWithFilters();
}

// Update map with current filters
const updateMapWithFilters = debounce(async function() {
    if (!fullscreenMapInstance) {
        console.warn('⚠️ Map not initialized yet');
        return;
    }
    
    // ✅ ИСПРАВЛЕНИЕ #3: Очищаем все старые маркеры перед пересройкой
    fullscreenMapInstance.geoObjects.removeAll();
    console.log('🗺️ Cleared old markers - ready for filter update');
    
    // Show loading indicator
    const loadingEl = document.getElementById('mapFilterLoading');
    if (loadingEl) loadingEl.classList.remove('hidden');
    
    try {
        // Build query params from filters
        const params = new URLSearchParams();
        
        // CRITICAL: Add city_id to filter by current city!
        if (window.currentCityId) {
            params.append('city_id', window.currentCityId);
        }
        
        if (mapFilters.rooms.length > 0) {
            mapFilters.rooms.forEach(room => params.append('rooms', room));
        }
        // Convert price from millions to rubles
        if (mapFilters.price_min) {
            const val = parseFloat(mapFilters.price_min);
            params.append('price_min', val < 1000 ? val * 1000000 : val);
        }
        if (mapFilters.price_max) {
            const val = parseFloat(mapFilters.price_max);
            params.append('price_max', val < 1000 ? val * 1000000 : val);
        }
        if (mapFilters.area_min) params.append('area_min', mapFilters.area_min);
        if (mapFilters.area_max) params.append('area_max', mapFilters.area_max);
        if (mapFilters.floor_min) params.append('floor_min', mapFilters.floor_min);
        if (mapFilters.floor_max) params.append('floor_max', mapFilters.floor_max);
        
        if (mapFilters.developers.length > 0) {
            mapFilters.developers.forEach(dev => params.append('developers', dev));
        }
        if (mapFilters.completion.length > 0) {
            mapFilters.completion.forEach(year => params.append('completion', year));
        }
        if (mapFilters.object_classes.length > 0) {
            mapFilters.object_classes.forEach(cls => params.append('object_classes', cls));
        }
        if (mapFilters.building_status.length > 0) {
            mapFilters.building_status.forEach(status => params.append('building_status', status));
        }
        
        const urlPT = new URLSearchParams(window.location.search).get('property_type');
        if (urlPT && urlPT !== 'all') {
            params.append('property_type', urlPT);
        }
        
        console.log('🗺️ Fetching filtered properties with city_id:', window.currentCityId, params.toString());
        
        // Fetch ALL filtered properties (paginated)
        let allProperties = [];
        let page = 1;
        let totalPages = 1;
        
        do {
            const pageParams = new URLSearchParams(params);
            pageParams.append('per_page', '500');
            pageParams.append('page', page);
            
            const response = await fetch(`/api/map-properties?${pageParams.toString()}`);
            const data = await response.json();
            
            if (!data.success || !data.properties) {
                break;
            }
            
            allProperties = allProperties.concat(data.properties);
            totalPages = data.pagination?.pages || 1;
            page++;
            
            console.log(`📥 Fetched filtered page ${page-1}/${totalPages}, total: ${allProperties.length}`);
        } while (page <= totalPages);
        
        console.log(`✅ Loaded ${allProperties.length} filtered properties`);
        
        // Clear existing markers
        fullscreenMapInstance.geoObjects.removeAll();
        
        // Update BOTH counters (mobile + desktop)
        const counter = document.getElementById('mapObjectsCount');
        const desktopCounter = document.getElementById('mapObjectsCountDesktop');
        if (counter) {
            counter.textContent = allProperties.length;
        }
        if (desktopCounter) {
            desktopCounter.textContent = allProperties.length;
        }
        
        if (allProperties.length > 0) {
            // Group properties by coordinates
            const grouped = groupPropertiesByCoords(allProperties);
            console.log(`📊 Grouped ${allProperties.length} properties into ${grouped.length} location groups`);
            
            // Create new markers
            grouped.forEach(group => {
                try {
                    const placemark = createEnhancedYandexMarker(group.properties);
                    fullscreenMapInstance.geoObjects.add(placemark);
                } catch (error) {
                    console.error('❌ Error creating marker:', error, group);
                }
            });
            
            console.log(`✅ Created ${grouped.length} markers on filtered map`);
            
            // Update left panel with filtered properties
            updateDesktopPropertiesPanel(allProperties, 'Отфильтрованные объекты');
            
            // Auto-center map to show all filtered properties
            const coords = allProperties
                .filter(p => p.coordinates && p.coordinates.lat && p.coordinates.lng)
                .map(p => p.coordinates);
            
            if (coords.length > 0) {
                const bounds = coords.reduce((acc, coord) => {
                    if (!acc.minLat || coord.lat < acc.minLat) acc.minLat = coord.lat;
                    if (!acc.maxLat || coord.lat > acc.maxLat) acc.maxLat = coord.lat;
                    if (!acc.minLng || coord.lng < acc.minLng) acc.minLng = coord.lng;
                    if (!acc.maxLng || coord.lng > acc.maxLng) acc.maxLng = coord.lng;
                    return acc;
                }, {});
                
                fullscreenMapInstance.setBounds([
                    [bounds.minLat, bounds.minLng],
                    [bounds.maxLat, bounds.maxLng]
                ], {
                    checkZoomRange: true,
                    zoomMargin: 40
                });
                
                console.log(`🎯 Map centered on ${coords.length} filtered properties`);
            }
        } else {
            console.log('⚠️ No properties match current filters - clearing sidebar');
            const container = document.getElementById('mapDesktopPropertiesContainer');
            if (container) {
                container.innerHTML = '';
                container.style.display = 'grid';
                container.style.gridTemplateColumns = '1fr 1fr';
                
                const header = document.createElement('div');
                header.className = 'col-span-2 sticky top-0 bg-white z-10 pb-3 border-b border-gray-300 mb-4';
                header.innerHTML = `
                    <div class="flex items-center justify-between">
                        <div>
                            <h3 class="font-bold text-lg text-gray-800">Отфильтрованные объекты</h3>
                            <p class="text-sm text-gray-500">0 объектов</p>
                        </div>
                    </div>
                `;
                container.appendChild(header);
                
                const emptyMsg = document.createElement('div');
                emptyMsg.className = 'col-span-2 text-center py-16';
                emptyMsg.innerHTML = `
                    <svg class="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    </svg>
                    <p class="text-gray-500 font-medium mb-1">Объектов не найдено</p>
                    <p class="text-gray-400 text-sm">Попробуйте изменить параметры фильтра</p>
                `;
                container.appendChild(emptyMsg);
            }
        }
        
        // Update active filters display
        updateActiveFiltersDisplay();
        
        // Show/hide reset button
        const hasFilters = mapFilters.rooms.length > 0 || 
                          mapFilters.price_min || mapFilters.price_max ||
                          mapFilters.area_min || mapFilters.area_max ||
                          mapFilters.floor_min || mapFilters.floor_max ||
                          mapFilters.developers.length > 0 ||
                          mapFilters.completion.length > 0 ||
                          mapFilters.object_classes.length > 0;
        
        const resetBtn = document.getElementById('mapResetFiltersBtn');
        if (resetBtn) {
            if (hasFilters) {
                resetBtn.classList.remove('hidden');
            } else {
                resetBtn.classList.add('hidden');
            }
        }
        
    } catch (error) {
        console.error('❌ Error updating map with filters:', error);
    } finally {
        // Hide loading indicator
        if (loadingEl) loadingEl.classList.add('hidden');
    }
}, 500); // 500ms debounce

// Update active filters display
function updateActiveFiltersDisplay() {
    const container = document.getElementById('mapActiveFilters');
    if (!container) return;
    
    const pills = [];
    
    // Room filters
    if (mapFilters.rooms.length > 0) {
        const roomLabels = mapFilters.rooms.map(r => {
            if (r === 0) return 'Студия';
            if (r === 4) return '4+комн';
            return `${r}-комн`;
        });
        pills.push(`<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
            Комнат: ${roomLabels.join(', ')}
        </span>`);
    }
    
    // Price filter
    if (mapFilters.price_min || mapFilters.price_max) {
        const priceText = [];
        if (mapFilters.price_min) priceText.push(`от ${mapFilters.price_min}М`);
        if (mapFilters.price_max) priceText.push(`до ${mapFilters.price_max}М`);
        pills.push(`<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
            ${priceText.join(' ')}
        </span>`);
    }
    
    // Area filter
    if (mapFilters.area_min || mapFilters.area_max) {
        const areaText = [];
        if (mapFilters.area_min) areaText.push(`от ${mapFilters.area_min}м²`);
        if (mapFilters.area_max) areaText.push(`до ${mapFilters.area_max}м²`);
        pills.push(`<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
            ${areaText.join(' ')}
        </span>`);
    }
    
    // Developers filter
    if (mapFilters.developers.length > 0) {
        pills.push(`<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
            Застройщиков: ${mapFilters.developers.length}
        </span>`);
    }
    
    // Completion filter
    if (mapFilters.completion.length > 0) {
        pills.push(`<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
            Сдача: ${mapFilters.completion.join(', ')}
        </span>`);
    }
    
    if (pills.length > 0) {
        container.innerHTML = pills.join('');
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

// Update map filters badge counter
function updateMapFiltersBadge() {
    const counterMap = document.getElementById('advancedFiltersCounterMap');
    
    let count = 0;
    
    // Count selected rooms
    count += mapFilters.rooms.length;
    
    // Count price filter (if either min or max is set)
    if (mapFilters.price_min || mapFilters.price_max) {
        count++;
    }
    
    // Count area filter (if either min or max is set)
    if (mapFilters.area_min || mapFilters.area_max) {
        count++;
    }
    
    // Count developers
    count += mapFilters.developers.length;
    
    // Count completion filters
    count += mapFilters.completion.length;
    
    // Update badge
    if (counterMap) {
        if (count > 0) {
            counterMap.textContent = count;
            counterMap.classList.remove('hidden');
        } else {
            counterMap.classList.add('hidden');
        }
    }
    
    console.log(`📊 Map filters count: ${count} (rooms: ${mapFilters.rooms.length}, price: ${mapFilters.price_min || mapFilters.price_max ? 1 : 0}, developers: ${mapFilters.developers.length})`);
}

// ✅ NEW: Load more cards for infinite scroll
function loadMoreDesktopCards() {
    if (isLoadingMoreCards) return;
    
    const container = document.getElementById('mapDesktopPropertiesContainer');
    if (!container) return;
    
    // Use mapAllProperties or initialMapProperties as source
    const sourceProperties = window.mapAllProperties || window.initialMapProperties || [];
    if (sourceProperties.length === 0) return;
    
    const startIndex = currentDisplayOffset;
    const endIndex = Math.min(startIndex + CARDS_PER_PAGE, sourceProperties.length);
    
    if (startIndex >= sourceProperties.length) {
        console.log('📋 All cards already loaded');
        return; // All cards already loaded
    }
    
    isLoadingMoreCards = true;
    console.log(`📥 Loading cards ${startIndex + 1}-${endIndex} of ${sourceProperties.length}`);
    
    // Add next batch of cards
    sourceProperties.slice(startIndex, endIndex).forEach(property => {
        const card = createDesktopPropertyCard(property);
        container.appendChild(card);
    });
    
    currentDisplayOffset = endIndex;
    isLoadingMoreCards = false;
    console.log(`✅ Loaded cards up to ${endIndex}`);
}

// ✅ NEW: Filter properties by map viewport and update left panel
function updateDesktopPanelByViewport() {
    if (!fullscreenMapInstance) return;
    
    const container = document.getElementById('mapDesktopPropertiesContainer');
    if (!container) return;
    
    // Get map bounds
    const bounds = fullscreenMapInstance.getBounds();
    if (!bounds) return;
    
    const [[minLat, minLng], [maxLat, maxLng]] = bounds;
    
    // Get all properties from all sources
    const allProperties = window.mapAllProperties || window.initialMapProperties || window.mapInitialProperties || [];
    
    // Filter properties that are visible in current viewport
    const visibleProperties = allProperties.filter(prop => {
        if (!prop.coordinates || !prop.coordinates.lat || !prop.coordinates.lng) return false;
        
        const lat = parseFloat(prop.coordinates.lat);
        const lng = parseFloat(prop.coordinates.lng);
        
        return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
    });
    
    // If very few or no properties, don't disrupt user - keep current view
    if (visibleProperties.length < 2) {
        console.log('📍 Less than 2 properties in viewport - keeping current view');
        return;
    }
    
    console.log(`🗺️ VIEWPORT UPDATE: ${visibleProperties.length} of ${allProperties.length} properties visible`);
    
    // Update the global properties list with filtered results
    window.mapAllProperties = visibleProperties;
    currentViewportProperties = visibleProperties;
    
    // Clear container and reset infinite scroll position
    container.innerHTML = '';
    currentDisplayOffset = 0;
    isLoadingMoreCards = false;
    
    // Load first batch of viewport-filtered properties
    console.log('📦 Loading first batch of viewport-filtered properties...');
    loadMoreDesktopCards();
}

// Update desktop properties panel with complex header and property cards
function updateDesktopPropertiesPanel(properties, complexName) {
    const container = document.getElementById('mapDesktopPropertiesContainer');
    if (!container) {
        console.warn('⚠️ Desktop properties container not found');
        return;
    }
    
    console.log(`🏢 Updating desktop panel: ${complexName} (${properties.length} properties)`);
    
    // 🎯 КРИТИЧНО: Убедимся что контейнер ВИДИМ (не скрыт)
    container.style.display = 'grid';
    container.style.visibility = 'visible';
    container.style.opacity = '1';
    
    // Clear previous content
    container.innerHTML = '';
    currentDisplayOffset = 0; // Reset scroll offset
    
    // ✅ ИСПРАВЛЕНО: Keep 2-column grid layout even when showing selected group
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gap = '12px';
    
    // Add complex header with close button and complex image
    const header = document.createElement('div');
    header.className = 'mb-4 pb-3 border-b border-gray-300 sticky top-0 bg-white z-10 col-span-2';
    
    // Get complex image from first property (use 2nd image from gallery - 1st is always floor plan)
    let complexImage = 'https://images.unsplash.com/photo-1545324418-cc1a9f4ef042?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80';
    if (properties.length > 0) {
        const firstProp = properties[0];
        // Try to get 2nd image (1st is always floor plan)
        if (firstProp.gallery_images) {
            try {
                const imgs = Array.isArray(firstProp.gallery_images) ? firstProp.gallery_images : JSON.parse(firstProp.gallery_images);
                if (imgs.length > 1) complexImage = imgs[1];  // 2nd image
                else if (imgs.length > 0) complexImage = imgs[0];  // fallback to 1st
            } catch(e) {}
        } else if (firstProp.main_image) complexImage = firstProp.main_image;
    }
    
    // ✅ ИСПРАВЛЕНО: Show complex photo only for specific cases (not for filtered results)
    const showComplexPhoto = complexName !== 'Отфильтрованные объекты' && complexName !== 'Свойства в области';
    const photoHTML = showComplexPhoto ? `
        <div class="rounded-lg overflow-hidden -mx-4 -mb-4">
            <img src="${complexImage}" alt="${complexName}" class="w-full h-24 object-cover" 
                 onerror="this.src='https://images.unsplash.com/photo-1545324418-cc1a9f4ef042?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'">
        </div>
    ` : '';
    
    header.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <div>
                <h3 class="font-bold text-lg text-gray-800">${complexName}</h3>
                <p class="text-sm text-gray-500">${properties.length} ${properties.length === 1 ? 'объект' : 'объектов'}</p>
            </div>
            <button onclick="closeMapPanelSelection()" class="text-gray-400 hover:text-gray-600 transition">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
        ${photoHTML}
    `;
    container.appendChild(header);
    
    // Add property cards with all details + hover sync
    properties.forEach(property => {
        const card = createDesktopPropertyCard(property);
        
        // 🎯 Add hover sync: highlight marker on card hover
        card.addEventListener('mouseenter', function() {
            if (!fullscreenMapInstance) return;
            
            // Find and highlight marker with this property's coordinates
            fullscreenMapInstance.geoObjects.each(placemark => {
                if (!placemark.geometry) return;
                
                const markerCoords = placemark.geometry.getCoordinates();
                const propLat = property.coordinates?.lat;
                const propLng = property.coordinates?.lng;
                
                if (markerCoords && markerCoords[0] === propLat && markerCoords[1] === propLng) {
                    // Highlight this marker with RED preset
                    placemark.options.set('preset', 'islands#redCircleIcon');
                    placemark.options.set('zIndex', 1000);
                }
            });
            
            // Highlight the card
            card.classList.add('bg-blue-50', 'border-blue-400');
        });
        
        card.addEventListener('mouseleave', function() {
            if (!fullscreenMapInstance) return;
            
            // Restore marker to normal state
            fullscreenMapInstance.geoObjects.each(placemark => {
                const markerCoords = placemark.geometry?.getCoordinates();
                const propLat = property.coordinates?.lat;
                const propLng = property.coordinates?.lng;
                
                if (markerCoords && markerCoords[0] === propLat && markerCoords[1] === propLng) {
                    // Restore original preset
                    placemark.options.set('preset', 'islands#orangeCircleDotIcon');
                    placemark.options.set('zIndex', 500);
                }
            });
            
            // Remove card highlight
            card.classList.remove('bg-blue-50', 'border-blue-400');
        });
        
        container.appendChild(card);
    });
    
    console.log(`✅ Desktop panel updated with ${properties.length} cards`);
}

// Close panel selection (return to initial cards)
function closeMapPanelSelection() {
    const container = document.getElementById('mapDesktopPropertiesContainer');
    if (!container) return;
    
    console.log('🗺️ Closing panel selection - returning to initial properties');
    
    // ✅ ИСПРАВЛЕНИЕ #4: Очищаем маркеры со старого выбора перед перестройкой
    if (fullscreenMapInstance) {
        fullscreenMapInstance.geoObjects.removeAll();
        console.log('🗺️ Cleared all markers from map');
    }
    
    container.innerHTML = '';
    
    // Reset to 2-column grid layout
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gap = '12px';
    
    // ✅ КРИТИЧНО: Обновить ОБА счетчика на исходное число!
    const counter = document.getElementById('mapObjectsCount');
    const desktopCounter = document.getElementById('mapObjectsCountDesktop');
    if (window.initialMapProperties) {
        if (counter) counter.textContent = window.initialMapProperties.length;
        if (desktopCounter) desktopCounter.textContent = window.initialMapProperties.length;
        console.log(`✅ Updated counters to ${window.initialMapProperties.length}`);
    }
    
    // Reload initial properties
    if (window.initialMapProperties && window.initialMapProperties.length > 0) {
        const header = document.createElement('div');
        header.className = 'mb-4 pb-3 border-b border-gray-300 sticky top-0 bg-white z-10 col-span-2';
        header.innerHTML = `
            <h3 class="font-bold text-lg text-gray-800">Объекты на карте</h3>
            <p class="text-sm text-gray-500">${window.initialMapProperties.length} объектов всего</p>
        `;
        container.appendChild(header);
        
        window.initialMapProperties.slice(0, 20).forEach(property => {
            const card = createDesktopPropertyCard(property);
            container.appendChild(card);
        });
        
        // ✅ Перестраиваем маркеры на карте для всех свойств
        console.log(`🗺️ Rebuilding markers for ${window.initialMapProperties.length} properties`);
        const grouped = groupPropertiesByCoords(window.initialMapProperties);
        grouped.forEach(group => {
            try {
                const placemark = createEnhancedYandexMarker(group.properties);
                if (placemark) fullscreenMapInstance.geoObjects.add(placemark);
            } catch (error) {
                console.error('❌ Error adding marker:', error);
            }
        });
    }
}

// Image slider functionality for property cards
let imageSliders = new Map();

function startImageSlider(container) {
    const card = container.closest('[data-property-card-id]');
    const images = card ? card.imageData : null;
    if (!images || images.length <= 1) return;
    
    const img = container.querySelector('.main-image');
    const indicator = container.querySelector('.slider-indicator');
    
    if (indicator) indicator.classList.remove('hidden');
    
    let currentIndex = 0;
    const interval = setInterval(() => {
        currentIndex = (currentIndex + 1) % images.length;
        if (img) img.src = images[currentIndex];
        if (indicator) indicator.textContent = `${currentIndex + 1}/${images.length}`;
    }, 800);
    
    imageSliders.set(container, {
        interval: interval,
        images: images,
        originalImage: img ? img.src : images[0]
    });
}

function stopImageSlider(container) {
    const sliderData = imageSliders.get(container);
    if (sliderData) {
        clearInterval(sliderData.interval);
        const img = container.querySelector('.main-image');
        const indicator = container.querySelector('.slider-indicator');
        
        if (img && sliderData.images && sliderData.images.length > 0) {
            img.src = sliderData.images[0];
        }
        if (indicator) indicator.classList.add('hidden');
        imageSliders.delete(container);
    }
}

function nextSliderImage(container) {
    const card = container.closest('[data-property-card-id]');
    const images = card ? card.imageData : null;
    if (!images || images.length <= 1) return;
    
    const img = container.querySelector('.main-image');
    const indicator = container.querySelector('.slider-indicator');
    
    if (!img || !indicator) return;
    
    const currentSrc = img.src;
    let currentIndex = images.findIndex(url => currentSrc.includes(url.split('/').pop()));
    if (currentIndex === -1) currentIndex = 0;
    
    const nextIndex = (currentIndex + 1) % images.length;
    img.src = images[nextIndex];
    indicator.textContent = `${nextIndex + 1}/${images.length}`;
    
    indicator.classList.remove('hidden');
    setTimeout(() => {
        const sliderData = imageSliders.get(container);
        if (!sliderData) {
            indicator.classList.add('hidden');
        }
    }, 1500);
}

// ✅ NEW: Set up Intersection Observer for infinite scroll
function initInfiniteScroll() {
    const container = document.getElementById('mapDesktopPropertiesContainer');
    if (!container) return;
    
    // Create sentinel element for scroll detection
    const sentinel = document.createElement('div');
    sentinel.id = 'map-scroll-sentinel';
    sentinel.style.height = '20px';
    sentinel.style.visibility = 'hidden';
    
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            console.log('📍 Sentinel visible - loading more cards...');
            loadMoreDesktopCards();
            // Re-add sentinel to detect next scroll
            if (container.lastChild && container.lastChild.id !== 'map-scroll-sentinel') {
                container.appendChild(sentinel);
            }
        }
    }, { threshold: 0.1 });
    
    container.appendChild(sentinel);
    observer.observe(sentinel);
    
    console.log('✅ Infinite scroll initialized');
}

// ✅ DISABLED: Map viewport change listener was causing filtered results to disappear
// Only use explicit filters from user, not automatic viewport filtering
function initMapViewportListener() {
    console.log('⚠️ Viewport listener DISABLED - filtered results stay visible until user changes filter');
    // Do nothing - viewport filtering was causing issues
}

// Make filter functions globally available
window.toggleMapRoomFilter = toggleMapRoomFilter;
window.openMapAdvancedFilters = openMapAdvancedFilters;
window.closeMapAdvancedFilters = closeMapAdvancedFilters;
window.resetMapAdvancedFilters = resetMapAdvancedFilters;
window.applyMapAdvancedFilters = applyMapAdvancedFilters;
window.resetMapFilters = resetMapFilters;
window.toggleToolbarRoomFilter = toggleToolbarRoomFilter;
window.updateMapFiltersBadge = updateMapFiltersBadge;
window.startImageSlider = startImageSlider;
window.stopImageSlider = stopImageSlider;
window.nextSliderImage = nextSliderImage;
window.updateDesktopPropertiesPanel = updateDesktopPropertiesPanel;

// ============================================
// 🎯 DRAWING FUNCTIONALITY FOR YANDEX MAPS
// ============================================

let isMapDrawing = false;
let drawnPolygonYandex = null;
let drawingPoints = [];
let drawingMarkers = [];
let drawingPolyline = null;

function enableMapDrawing() {
    if (!fullscreenMapInstance) {
        console.warn('⚠️ Map not initialized');
        return;
    }
    
    isMapDrawing = true;
    console.log('🎨 Drawing mode enabled');
    
    // DISABLE map dragging so clicks work for drawing
    fullscreenMapInstance.container.getElement().style.cursor = 'crosshair';
    
    // Try to disable dragging behavior
    try {
        // In Yandex Maps 3.x, dragging is controlled through behaviors
        const behaviors = fullscreenMapInstance.behaviors.get('drag');
        if (behaviors) {
            behaviors.disable();
        }
    } catch (e) {
        console.log('ℹ️ Could not disable drag behavior (expected)');
    }
    
    // Update button state
    const drawBtn = document.getElementById('mapDrawAreaBtn');
    const clearBtn = document.getElementById('mapClearAreaBtn');
    if (drawBtn) {
        drawBtn.classList.add('bg-orange-500', 'text-white', '!border-orange-500');
        drawBtn.classList.remove('border-gray-300', 'hover:border-blue-600');
        drawBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>Кликните точки на карте';
    }
    if (clearBtn) {
        clearBtn.classList.remove('hidden');
    }
    
    // Clear previous drawing
    drawingPoints = [];
    drawingMarkers = [];
    if (drawingPolyline) {
        fullscreenMapInstance.geoObjects.remove(drawingPolyline);
    }
    
    // Drawing event handler is already added in openFullscreenMap() when map is initialized
}

function finishMapDrawing() {
    if (drawingPoints.length < 3) {
        console.warn('⚠️ Need at least 3 points to create polygon');
        return;
    }
    
    console.log('🎨 Finishing drawing with', drawingPoints.length, 'points');
    
    // Remove temporary markers and polyline
    drawingMarkers.forEach(marker => {
        fullscreenMapInstance.geoObjects.remove(marker);
    });
    drawingMarkers = [];
    if (drawingPolyline) {
        fullscreenMapInstance.geoObjects.remove(drawingPolyline);
        drawingPolyline = null;
    }
    
    // Create final polygon
    if (drawnPolygonYandex) {
        fullscreenMapInstance.geoObjects.remove(drawnPolygonYandex);
    }
    
    // Close the polygon by adding first point at end
    const closedPoints = [...drawingPoints];
    if (closedPoints[0] !== closedPoints[closedPoints.length - 1]) {
        closedPoints.push(closedPoints[0]);
    }
    
    drawnPolygonYandex = new ymaps.Polygon([closedPoints], {}, {
        fillColor: '#ff6b3540',
        strokeColor: '#ff6b35',
        strokeWidth: 3,
        strokeOpacity: 0.8
    });
    
    fullscreenMapInstance.geoObjects.add(drawnPolygonYandex);
    
    // Reset drawing state
    isMapDrawing = false;
    
    // RE-ENABLE map dragging
    fullscreenMapInstance.container.getElement().style.cursor = 'grab';
    try {
        const behaviors = fullscreenMapInstance.behaviors.get('drag');
        if (behaviors) {
            behaviors.enable();
        }
    } catch (e) {
        console.log('ℹ️ Could not re-enable drag behavior');
    }
    
    // 🎯 Update buttons to show "Clear" instead of "Draw"
    const drawBtn = document.getElementById('mapDrawAreaBtn');
    const clearBtn = document.getElementById('mapClearAreaBtn');
    if (drawBtn) {
        drawBtn.classList.remove('bg-orange-500', 'text-white', '!border-orange-500');
        drawBtn.classList.add('border-gray-300', 'hover:border-blue-600');
        drawBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>Выделить область';
        drawBtn.onclick = function() {
            enableMapDrawing();
        };
    }
    if (clearBtn) {
        clearBtn.classList.remove('hidden');
        clearBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>Очистить';
        clearBtn.onclick = function() {
            clearMapDrawnArea();
        };
    }
    
    // Filter properties by polygon
    filterPropertiesByPolygonYandex();
    console.log('✅ Polygon completed and properties filtered');
}

function clearMapDrawnArea() {
    console.log('🗑️ Clearing drawn area');
    
    // Remove polygon
    if (drawnPolygonYandex) {
        fullscreenMapInstance.geoObjects.remove(drawnPolygonYandex);
        drawnPolygonYandex = null;
    }
    
    // Reset drawing state
    isMapDrawing = false;
    drawingPoints = [];
    drawingMarkers = [];
    if (drawingPolyline) {
        fullscreenMapInstance.geoObjects.remove(drawingPolyline);
        drawingPolyline = null;
    }
    
    // RE-ENABLE map dragging
    fullscreenMapInstance.container.getElement().style.cursor = 'grab';
    try {
        const behaviors = fullscreenMapInstance.behaviors.get('drag');
        if (behaviors) {
            behaviors.enable();
        }
    } catch (e) {
        console.log('ℹ️ Could not re-enable drag behavior');
    }
    
    // 🎯 Update buttons - HIDE clear button and SHOW draw button
    const drawBtn = document.getElementById('mapDrawAreaBtn');
    const clearBtn = document.getElementById('mapClearAreaBtn');
    if (drawBtn) {
        drawBtn.classList.remove('bg-orange-500', 'text-white', '!border-orange-500');
        drawBtn.classList.add('border-gray-300', 'hover:border-blue-600');
        drawBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>Выделить область';
    }
    if (clearBtn) {
        clearBtn.classList.add('hidden');
    }
    
    // Return to all properties
    updateMapWithFilters();
}

function filterPropertiesByPolygonYandex() {
    if (!drawnPolygonYandex || !window.initialMapProperties) {
        console.warn('⚠️ No polygon or properties');
        return;
    }
    
    console.log(`🔍🔍🔍 POLYGON FILTERING START`);
    console.log(`📊 Total properties: ${window.initialMapProperties.length}`);
    console.log(`📍 Drawing points (${drawingPoints.length}):`, drawingPoints.slice(0, 3), '...');
    
    // Get polygon bounds
    const bounds = drawnPolygonYandex.geometry.getBounds();
    console.log(`📦 Polygon bounds: SW[${bounds[0][0].toFixed(4)}, ${bounds[0][1].toFixed(4)}] to NE[${bounds[1][0].toFixed(4)}, ${bounds[1][1].toFixed(4)}]`);
    
    // Filter properties inside polygon
    let totalChecked = 0;
    let totalInBounds = 0;
    const propertiesInsidePolygon = window.initialMapProperties.filter(prop => {
        totalChecked++;
        
        if (!prop.coordinates) {
            return false;
        }
        
        const lat = prop.coordinates.lat;
        const lng = prop.coordinates.lng;
        
        // Check if inside polygon bounds (simple check)
        if (lat < bounds[0][0] || lat > bounds[1][0] ||
            lng < bounds[0][1] || lng > bounds[1][1]) {
            return false;
        }
        
        totalInBounds++;
        
        // Point-in-polygon test
        const inside = isPointInPolygon([lat, lng], drawingPoints);
        if (inside) {
            console.log(`✅ ID:${prop.id} INSIDE at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
        } else {
            // Log first few failures for debugging
            if (totalInBounds <= 3) {
                console.log(`❌ ID:${prop.id} OUTSIDE at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
            }
        }
        return inside;
    });
    
    console.log(`🔍🔍🔍 FILTERING COMPLETE: Found ${propertiesInsidePolygon.length}/${totalChecked} properties (${totalInBounds} in bounds)`);
    
    // 🎯 ИСПРАВЛЕНИЕ 2: Убедимся что контейнер очищен ПЕРЕД заполнением
    const container = document.getElementById('mapDesktopPropertiesContainer');
    if (container) {
        container.innerHTML = '';
    }
    
    // Update map with filtered properties
    fullscreenMapInstance.geoObjects.removeAll();
    
    // Update counters
    const counter = document.getElementById('mapObjectsCount');
    const desktopCounter = document.getElementById('mapObjectsCountDesktop');
    if (counter) counter.textContent = propertiesInsidePolygon.length;
    if (desktopCounter) desktopCounter.textContent = propertiesInsidePolygon.length;
    
    // 🎯 ИСПРАВЛЕНИЕ 2: Update left panel ПОСЛЕ очистки
    if (propertiesInsidePolygon.length > 0) {
        updateDesktopPropertiesPanel(propertiesInsidePolygon, 'Свойства в области');
    } else {
        console.warn('⚠️ No properties found inside polygon - showing empty state');
    }
    
    // Redraw polygon
    fullscreenMapInstance.geoObjects.add(drawnPolygonYandex);
    
    // Add markers for filtered properties
    const grouped = groupPropertiesByCoords(propertiesInsidePolygon);
    grouped.forEach(group => {
        try {
            const placemark = createEnhancedYandexMarker(group.properties);
            fullscreenMapInstance.geoObjects.add(placemark);
        } catch (error) {
            console.error('❌ Error creating marker:', error);
        }
    });
}

function isPointInPolygon(point, polygonPoints) {
    const [lat, lng] = point;  // [latitude, longitude]
    let inside = false;
    
    // 🎯 Ray casting algorithm for point-in-polygon
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
        const [lat1, lng1] = polygonPoints[i];
        const [lat2, lng2] = polygonPoints[j];
        
        // Check if ray crosses polygon edge
        const intersect = ((lng1 > lng) !== (lng2 > lng)) &&
            (lat < (lat2 - lat1) * (lng - lng1) / (lng2 - lng1) + lat1);
        if (intersect) inside = !inside;
    }
    
    return inside;
}

// Make functions globally available
window.enableMapDrawing = enableMapDrawing;
window.clearMapDrawnArea = clearMapDrawnArea;
window.closeMapPanelSelection = closeMapPanelSelection;
window.loadMoreDesktopCards = loadMoreDesktopCards;
window.updateDesktopPanelByViewport = updateDesktopPanelByViewport;
window.initInfiniteScroll = initInfiniteScroll;
window.initMapViewportListener = initMapViewportListener;

// Add CSS for highlighted cards and slider animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    .highlighted-card {
        background-color: #f0f7ff !important;
        border-color: #0088CC !important;
        box-shadow: 0 0 12px rgba(0, 136, 204, 0.3) !important;
        transform: translateY(-2px);
        transition: all 0.2s ease;
    }
    
    .image-slider-container {
        position: relative;
        width: 100%;
        overflow: hidden;
    }
    
    .image-slider-container img {
        width: 100%;
        height: auto;
        display: block;
    }
    
    .slider-indicator {
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
    }
`;
document.head.appendChild(styleSheet);

console.log('✅ Map filters module loaded');


// ✅ NEW: Update map markers based on current filters
window.updateMapWithFilters = function() {
    if (!window.fullscreenMapInstance || !window.mapAllProperties) {
        console.warn('⚠️ Map or properties not ready for filter update');
        return;
    }
    
    console.log('🔄 updateMapWithFilters called - applying filters to map...');
    
    // Get current filter state
    const currentRoomFilter = window.mapFilters?.rooms || [];
    const currentPriceMin = window.mapFilters?.price_min ? parseFloat(window.mapFilters.price_min) : 0;
    const currentPriceMax = window.mapFilters?.price_max ? parseFloat(window.mapFilters.price_max) : Infinity;
    const currentAreaMin = window.mapFilters?.area_min ? parseFloat(window.mapFilters.area_min) : 0;
    const currentAreaMax = window.mapFilters?.area_max ? parseFloat(window.mapFilters.area_max) : Infinity;
    
    // Use mapAllProperties or mapInitialProperties as source
    const sourceData = window.mapAllProperties || window.mapInitialProperties || [];
    if (sourceData.length === 0) {
        console.warn('⚠️ No source properties found for filtering');
        return;
    }
    
    console.log(`📊 Filter state: rooms=${currentRoomFilter}, price=[${currentPriceMin}, ${currentPriceMax}], area=[${currentAreaMin}, ${currentAreaMax}]`);
    
    // Filter properties based on current state
    let filteredProperties = sourceData.filter(prop => {
        // Room filter
        if (currentRoomFilter.length > 0) {
            const rooms = prop.rooms || 0;
            if (!currentRoomFilter.includes(rooms)) return false;
        }
        
        // Price filter
        const price = prop.price || 0;
        if (price < currentPriceMin || price > currentPriceMax) return false;
        
        // Area filter
        const area = prop.area || 0;
        if (area < currentAreaMin || area > currentAreaMax) return false;
        
        // Floor filter
        const floor = prop.floor || 0;
        if (floor < currentFloorMin || floor > currentFloorMax) return false;
        
        return true;
    });
    
    console.log(`📊 Filters applied: ${filteredProperties.length} / ${window.mapAllProperties.length} properties match`);
    
    // Clear and re-render markers
    window.fullscreenMapInstance.geoObjects.removeAll();
    
    const grouped = groupPropertiesByCoords(filteredProperties);
    grouped.forEach(group => {
        try {
            const placemark = createEnhancedYandexMarker(group.properties);
            if (placemark) {
                window.fullscreenMapInstance.geoObjects.add(placemark);
            }
        } catch(error) {
            console.error('❌ Error adding filtered marker:', error);
        }
    });
    
    console.log(`✅ Updated map with ${grouped.length} marker groups from ${filteredProperties.length} filtered properties`);
    
    // Update left panel with filtered properties
    if (document.getElementById('mapDesktopPropertiesContainer')) {
        const propsContainer = document.getElementById('mapDesktopPropertiesContainer');
        propsContainer.innerHTML = '';
        
        const header = document.createElement('div');
        header.className = 'mb-4 pb-3 border-b border-gray-300 sticky top-0 bg-white z-10 col-span-2';
        header.innerHTML = `
            <h3 class="font-bold text-lg text-gray-800">Объекты на карте</h3>
            <p class="text-sm text-gray-500">${filteredProperties.length} объектов всего</p>
        `;
        propsContainer.appendChild(header);
        
        propsContainer.style.display = 'grid';
        propsContainer.style.gridTemplateColumns = '1fr 1fr';
        propsContainer.style.gap = '12px';
        
        // Load first batch and initialize infinite scroll
        const initialBatch = filteredProperties.slice(0, 20);
        initialBatch.forEach(prop => {
            const card = createDesktopPropertyCard(prop);
            propsContainer.appendChild(card);
        });
        
        // Initialize infinite scroll for remaining properties
        window.currentMapFilteredProperties = filteredProperties;
        window.currentMapDisplayOffset = 20;
        
        // Set up infinite scroll listener
        const scrollContainer = propsContainer.closest('[id="mapDesktopPropertiesContainer"]');
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', function() {
                const { scrollTop, scrollHeight, clientHeight } = this;
                if (scrollHeight - scrollTop <= clientHeight + 100) {
                    // Load more cards
                    const offset = window.currentMapDisplayOffset || 20;
                    const nextBatch = window.currentMapFilteredProperties.slice(offset, offset + 20);
                    nextBatch.forEach(prop => {
                        const card = createDesktopPropertyCard(prop);
                        propsContainer.appendChild(card);
                    });
                    window.currentMapDisplayOffset = offset + 20;
                }
            }, { once: true }); // Only set up once per filter
        }
    }
};

// ✅ Display active filters on the map
function displayMapActiveFilters() {
    const container = document.getElementById('mapActiveFiltersContainer');
    const filtersList = document.getElementById('mapActiveFiltersList');
    
    if (!container || !filtersList) return;
    
    const filters = [];
    
    // Collect quick room filters
    const quickRooms = document.querySelectorAll('button.quick-room-chip.active');
    quickRooms.forEach(btn => {
        const label = btn.textContent.trim();
        filters.push({ text: `Комнаты: ${label}`, type: 'room' });
    });
    
    // Collect advanced filters
    if (window.mapFilters) {
        // Object class filter
        if (window.mapFilters.object_classes && window.mapFilters.object_classes.length > 0) {
            filters.push({ text: `Класс: ${window.mapFilters.object_classes.join(', ')}`, type: 'class' });
        }
        
        // Completion year filter
        if (window.mapFilters.completion && window.mapFilters.completion.length > 0) {
            filters.push({ text: `Год: ${window.mapFilters.completion.join(', ')}`, type: 'year' });
        }
        
        // Building status filter
        if (window.mapFilters.building_status && window.mapFilters.building_status.length > 0) {
            const statusLabels = window.mapFilters.building_status.map(s => 
                s === 'delivered' ? 'Сдан' : s === 'under_construction' ? 'Строится' : s
            );
            filters.push({ text: `Статус: ${statusLabels.join(', ')}`, type: 'status' });
        }
        
        // Price filter
        if ((window.mapFilters.price_min || window.mapFilters.price_max) && 
            (window.mapFilters.price_min || window.mapFilters.price_max)) {
            let priceText = 'Цена: ';
            if (window.mapFilters.price_min) priceText += `от ${window.mapFilters.price_min}`;
            if (window.mapFilters.price_max) priceText += ` до ${window.mapFilters.price_max}`;
            filters.push({ text: priceText, type: 'price' });
        }
    }
    
    // Update display
    if (filters.length === 0) {
        container.classList.add('hidden');
        filtersList.innerHTML = '';
        // Hide counter
        const counter = document.getElementById('mapActiveFiltersCount');
        if (counter) counter.classList.add('hidden');
    } else {
        container.classList.remove('hidden');
        filtersList.innerHTML = filters.map(f => `
            <span class="bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded-full flex items-center gap-1">
                ${f.text}
                <button onclick="clearMapFilter('${f.type}')" class="ml-1 text-blue-400 hover:text-blue-600 hover:bg-blue-100 rounded-full w-4 h-4 flex items-center justify-center text-xs">×</button>
            </span>
        `).join('');
        
        // Show counter with count
        const counter = document.getElementById('mapActiveFiltersCount');
        if (counter) {
            counter.textContent = filters.length;
            counter.classList.remove('hidden');
        }
    }
}

// ✅ Clear specific filter
function clearMapFilter(type) {
    if (type === 'room') {
        document.querySelectorAll('button.quick-room-chip.active').forEach(btn => {
            btn.classList.remove('active', 'bg-blue-600', 'text-white', 'border-blue-600');
            btn.classList.add('border-gray-300');
        });
    } else if (window.mapFilters) {
        if (type === 'class') window.mapFilters.object_classes = [];
        if (type === 'year') window.mapFilters.completion = [];
        if (type === 'status') window.mapFilters.building_status = [];
        if (type === 'price') {
            window.mapFilters.price_min = '';
            window.mapFilters.price_max = '';
        }
    }
    
    if (typeof updateMapWithFilters === 'function') {
        updateMapWithFilters();
    }
}

// Export function
window.displayMapActiveFilters = displayMapActiveFilters;
window.clearMapFilter = clearMapFilter;

// ✅ Function to reload mini-map with current URL filters
window.reloadMiniMapWithFilters = function() {
    if (!miniPropertiesMapInstance) {
        console.log('🗺️ Mini-map not initialized yet, skipping reload');
        return;
    }
    
    // Clear existing markers
    miniPropertiesMapInstance.geoObjects.removeAll();
    
    // Get current filter params from URL
    const miniMapParams = getMiniMapFilterParams();
    console.log('🔄 Reloading mini-map with filters:', miniMapParams || '(none)');
    
    fetch('/api/mini-map/properties' + (miniMapParams ? '?' + miniMapParams : ''), {
        credentials: 'same-origin'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.coordinates && data.coordinates.length > 0) {
                console.log(`✅ Reloaded ${data.count} property coordinates for mini-map`);
                
                const clusters = clusterCoordinates(data.coordinates, 0.01);
                
                // Create markers
                clusters.forEach(cluster => {
                    const placemark = new ymaps.Placemark([cluster.lat, cluster.lng], {
                        iconContent: cluster.count
                    }, {
                        preset: 'islands#blueCircleIcon',
                        iconColor: '#0088CC'
                    });
                    
                    placemark.events.add('click', function(e) {
                        e.stopPropagation();
                        if (typeof handleMapClick === 'function') handleMapClick();
                    });
                    
                    miniPropertiesMapInstance.geoObjects.add(placemark);
                });
                
                console.log(`✅ Created ${clusters.length} clusters after filter reload`);
                
                // Auto-center map on new bounds
                if (data.coordinates.length > 0) {
                    const bounds = data.coordinates.reduce((acc, coord) => {
                        if (!acc.minLat || coord.lat < acc.minLat) acc.minLat = coord.lat;
                        if (!acc.maxLat || coord.lat > acc.maxLat) acc.maxLat = coord.lat;
                        if (!acc.minLng || coord.lng < acc.minLng) acc.minLng = coord.lng;
                        if (!acc.maxLng || coord.lng > acc.maxLng) acc.maxLng = coord.lng;
                        return acc;
                    }, {});
                    
                    miniPropertiesMapInstance.setBounds([
                        [bounds.minLat, bounds.minLng],
                        [bounds.maxLat, bounds.maxLng]
                    ], {
                        checkZoomRange: true,
                        zoomMargin: 20
                    });
                    
                    console.log(`🎯 Mini-map re-centered after filter reload`);
                }
            } else {
                console.log('⚠️ No coordinates returned after filter reload');
            }
        })
        .catch(error => {
            console.error('❌ Error reloading mini-map:', error);
        });
};

console.log('✅ reloadMiniMapWithFilters function registered');

// ✅ Function to reload FULLSCREEN map with current filters (including search)
window.reloadFullscreenMapWithFilters = function() {
    if (!fullscreenMapInstance) {
        console.log('🗺️ Fullscreen map not initialized yet, skipping reload');
        return;
    }
    
    // Build filter params including search
    const filterParams = getMiniMapFilterParams();
    console.log('🔄 Reloading fullscreen map with filters:', filterParams || '(none)');
    
    // Load data through API
    fetch('/api/map-properties?' + filterParams, {
        credentials: 'same-origin'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.properties && data.properties.length > 0) {
                console.log(`✅ Reloaded ${data.properties.length} properties for fullscreen map`);
                
                // Clear existing markers
                fullscreenMapInstance.geoObjects.removeAll();
                
                // Group by coordinates
                const grouped = groupPropertiesByCoords(data.properties);
                
                // Create markers
                grouped.forEach(group => {
                    try {
                        const placemark = createEnhancedYandexMarker(group.properties);
                        if (placemark) {
                            fullscreenMapInstance.geoObjects.add(placemark);
                        }
                    } catch (e) {
                        console.warn('Error adding marker:', e);
                    }
                });
                
                console.log(`✅ Rendered ${grouped.length} markers after search filter`);
                
                // Update window.mapAllProperties for list filtering
                window.mapAllProperties = data.properties;
                
                // Update counter
                const counter = document.getElementById('mapObjectsCount');
                const desktopCounter = document.getElementById('mapObjectsCountDesktop');
                if (counter) counter.textContent = data.properties.length;
                if (desktopCounter) desktopCounter.textContent = data.properties.length;
                
                // Update property cards on the left panel
                const propsContainer = document.getElementById('mapDesktopPropertiesContainer');
                if (propsContainer && typeof createDesktopPropertyCard === 'function') {
                    propsContainer.innerHTML = '';
                    
                    // Add header
                    const header = document.createElement('div');
                    header.className = 'mb-4 pb-3 border-b border-gray-300 sticky top-0 bg-white z-10 col-span-2';
                    header.innerHTML = `
                        <h3 class="font-bold text-lg text-gray-800">Объекты на карте</h3>
                        <p class="text-sm text-gray-500">${data.properties.length} объектов найдено</p>
                    `;
                    propsContainer.appendChild(header);
                    
                    // Set grid layout
                    propsContainer.style.display = 'grid';
                    propsContainer.style.gridTemplateColumns = '1fr 1fr';
                    propsContainer.style.gap = '12px';
                    
                    // Add cards (first 20)
                    data.properties.slice(0, 20).forEach(prop => {
                        const card = createDesktopPropertyCard(prop);
                        propsContainer.appendChild(card);
                    });
                    console.log(`✅ Updated ${Math.min(20, data.properties.length)} property cards after search filter`);
                }
                
            } else {
                console.log('⚠️ No properties found for current filters');
                fullscreenMapInstance.geoObjects.removeAll();
                
                // Update counters to 0
                const counter = document.getElementById('mapObjectsCount');
                const desktopCounter = document.getElementById('mapObjectsCountDesktop');
                if (counter) counter.textContent = '0';
                if (desktopCounter) desktopCounter.textContent = '0';
                
                // Clear property cards
                const propsContainer = document.getElementById('mapDesktopPropertiesContainer');
                if (propsContainer) {
                    propsContainer.innerHTML = '<div class="col-span-2 text-center text-gray-500 py-8">Объектов не найдено</div>';
                }
            }
        })
        .catch(error => {
            console.error('❌ Error reloading fullscreen map:', error);
        });
};

console.log('✅ reloadFullscreenMapWithFilters function registered');
