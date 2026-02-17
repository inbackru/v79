"""
Property Repository - Professional data access layer
Чистая работа с normalized таблицами: Developer → ResidentialComplex → Property
"""

import json
import hashlib
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import joinedload
from models import Property, ResidentialComplex, Developer, District
from app import db, cache


class PropertyRepository:
    """Repository для работы с квартирами через normalized структуру"""
    
    # Mapping для renovation_type → человекочитаемое название
    RENOVATION_DISPLAY_NAMES = {
        'no_renovation': 'Без отделки',
        'fine_finish': 'Чистовая',
        'rough_finish': 'Черновая',
        'design_repair': 'Дизайнерский ремонт',
        None: 'Без отделки'
    }
    
    @staticmethod
    def _make_cache_key_for_filters(filters=None):
        """Create cache key from filters dict for memoization"""
        if not filters:
            return 'count_active_no_filters'
        filter_str = json.dumps(filters, sort_keys=True, default=str)
        filter_hash = hashlib.md5(filter_str.encode()).hexdigest()
        return f'count_active_{filter_hash}'
    
    @staticmethod
    def _make_stats_cache_key(city_id=None):
        """Create cache key for property stats"""
        if city_id:
            return f'property_stats_city_{city_id}'
        return 'property_stats_all'
    
    @staticmethod
    def get_renovation_display_name(renovation_type):
        """Преобразовать renovation_type в человекочитаемое название"""
        return PropertyRepository.RENOVATION_DISPLAY_NAMES.get(renovation_type, 'Без отделки')
    
    @staticmethod
    def get_base_query():
        """
        Базовый query с JOIN всех связанных таблиц
        Использовать во всех запросах для consistency
        """
        return (
            db.session.query(Property)
            .join(ResidentialComplex, Property.complex_id == ResidentialComplex.id, isouter=True)
            .join(Developer, Property.developer_id == Developer.id, isouter=True)
            .join(District, Property.district_id == District.id, isouter=True)
            .options(
                joinedload(Property.residential_complex),
                joinedload(Property.developer),
                joinedload(Property.district)
            )
        )
    
    @staticmethod
    def get_all_active(limit=50, offset=0, filters=None, sort_by='price', sort_order='asc'):
        """
        Получить все активные квартиры с фильтрами - ПОЛНАЯ ПОДДЕРЖКА build_property_filters()
        
        Args:
            limit: Лимит записей
            offset: Смещение для пагинации
            filters: Dict с фильтрами {
                # Price and area
                'min_price': int, 'max_price': int,
                'min_area': float, 'max_area': float,
                
                # Rooms
                'rooms': list[int],
                
                # Floor filters
                'floor_min': int, 'floor_max': int,
                'floor_options': list[str],  # ['not_first', 'not_last']
                
                # Relations
                'complex_id': int,
                'developer_id': int,
                'developer': str,  # by name
                'developers': list[str],  # multiple developers by name
                'district': str,  # by name
                'districts': list[str],  # multiple districts by name
                'residential_complex': str,  # by name
                'building': str,  # building name
                
                # Building characteristics
                'building_types': list[str],
                'building_floors_min': int,
                'building_floors_max': int,
                
                # Completion dates
                'build_year_min': int,
                'build_year_max': int,
                'delivery_years': list[int],
                
                # Features
                'cashback_only': bool,
                'renovation': list[str],
                'object_classes': list[str],
                
                # Other
                'deal_type': str,
                'search': str  # search query
            }
            sort_by: str - Поле для сортировки ('price', 'area', 'date')
            sort_order: str - Порядок ('asc', 'desc')
        
        Returns:
            List[Property]: Список квартир с подгруженными связями
        """
        query = PropertyRepository.get_base_query()
        query = query.filter(Property.is_active == True)
        
        if filters:
            # Price filters
            if filters.get('min_price'):
                query = query.filter(Property.price >= filters['min_price'])
            if filters.get('max_price'):
                query = query.filter(Property.price <= filters['max_price'])
            
            # Area filters
            if filters.get('min_area'):
                query = query.filter(Property.area >= filters['min_area'])
            if filters.get('max_area'):
                query = query.filter(Property.area <= filters['max_area'])
            
            # Rooms filter
            if filters.get('rooms'):
                # Handle both int and string room values
                room_values = []
                for r in filters['rooms']:
                    try:
                        room_values.append(int(r))
                    except (ValueError, TypeError):
                        pass
                if room_values:
                    query = query.filter(Property.rooms.in_(room_values))
            
            # Floor filters
            if filters.get('floor_min'):
                query = query.filter(Property.floor >= filters['floor_min'])
            if filters.get('floor_max'):
                query = query.filter(Property.floor <= filters['floor_max'])
            
            # Floor options (not first/not last)
            if filters.get('floor_options'):
                for option in filters['floor_options']:
                    if option == 'not_first':
                        query = query.filter(Property.floor > 1)
                    elif option == 'not_last':
                        # Not on last floor: floor < total_floors
                        query = query.filter(Property.floor < Property.total_floors)
            
            # Complex filters
            if filters.get('complex_id'):
                query = query.filter(Property.complex_id == filters['complex_id'])
            
            if filters.get('residential_complex'):
                query = query.filter(ResidentialComplex.name == filters['residential_complex'])
            
            # Developer filters
            if filters.get('developer_id'):
                query = query.filter(Property.developer_id == filters['developer_id'])
            
            if filters.get('developer'):
                query = query.filter(Developer.name == filters['developer'])
            
            if filters.get('developers'):
                # Filter by developer IDs or names
                developer_ids = []
                developer_names = []
                for dev_value in filters['developers']:
                    if isinstance(dev_value, str) and dev_value.strip():
                        # Check if it's numeric ID or text name
                        if dev_value.strip().isdigit():
                            developer_ids.append(int(dev_value.strip()))
                        else:
                            developer_names.append(dev_value.strip())
                    elif isinstance(dev_value, int):
                        developer_ids.append(dev_value)
                
                # Apply filters
                conditions = []
                if developer_ids:
                    conditions.append(Property.developer_id.in_(developer_ids))
                if developer_names:
                    conditions.append(Developer.name.in_(developer_names))
                
                if conditions:
                    query = query.filter(or_(*conditions))
            
            # City filtering
            if filters.get('city_id'):
                query = query.filter(Property.city_id == filters['city_id'])
            
            # District filters - OR conditions for comprehensive district search
            # Searches across: District relation, parsed_district, parsed_settlement, parsed_area
            if filters.get('district'):
                district_name = filters['district'].strip() if filters['district'] else ''
                # Ignore empty district names to prevent matching everything
                if district_name:
                    query = query.filter(
                        or_(
                            and_(District.name.isnot(None), District.name.ilike(f'%{district_name}%')),
                            and_(Property.parsed_district.isnot(None), Property.parsed_district.ilike(f'%{district_name}%')),
                            and_(Property.parsed_settlement.isnot(None), Property.parsed_settlement.ilike(f'%{district_name}%')),
                            and_(Property.parsed_area.isnot(None), Property.parsed_area.ilike(f'%{district_name}%'))
                        )
                    )
            
            if filters.get('districts'):
                # Multiple districts - each district creates an OR condition across all fields
                district_conditions = []
                for district_name in filters['districts']:
                    # Ignore empty or whitespace-only district names
                    cleaned_name = district_name.strip() if isinstance(district_name, str) else ''
                    if cleaned_name:
                        district_conditions.append(
                            or_(
                                and_(District.name.isnot(None), District.name.ilike(f'%{cleaned_name}%')),
                                and_(Property.parsed_district.isnot(None), Property.parsed_district.ilike(f'%{cleaned_name}%')),
                                and_(Property.parsed_settlement.isnot(None), Property.parsed_settlement.ilike(f'%{cleaned_name}%')),
                                and_(Property.parsed_area.isnot(None), Property.parsed_area.ilike(f'%{cleaned_name}%'))
                            )
                        )
                if district_conditions:
                    query = query.filter(or_(*district_conditions))
            
            # Building name filter
            if filters.get('building'):
                query = query.filter(Property.complex_building_name == filters['building'])
            
            # Building floors range
            if filters.get('building_floors_min'):
                query = query.filter(Property.total_floors >= filters['building_floors_min'])
            if filters.get('building_floors_max'):
                query = query.filter(Property.total_floors <= filters['building_floors_max'])
            
            # Building types filter (if we had building_type field)
            if filters.get('building_types'):
                query = query.filter(Property.building_type.in_(filters['building_types']))
            
            # Delivery/completion years (через ResidentialComplex.end_build_year)
            if filters.get('build_year_min'):
                query = query.filter(ResidentialComplex.end_build_year >= filters['build_year_min'])
            if filters.get('build_year_max'):
                query = query.filter(ResidentialComplex.end_build_year <= filters['build_year_max'])
            if filters.get('delivery_years'):
                # Filter by list of years
                query = query.filter(ResidentialComplex.end_build_year.in_(filters['delivery_years']))
            
            # Cashback filter
            if filters.get('cashback_only'):
                query = query.filter(ResidentialComplex.cashback_rate > 0)
            
            # Renovation types
            if filters.get('renovation'):
                query = query.filter(Property.renovation_type.in_(filters['renovation']))
            
            # Object classes (через ResidentialComplex.object_class_display_name)
            if filters.get('object_classes'):
                query = query.filter(ResidentialComplex.object_class_display_name.in_(filters['object_classes']))
            
            # Building released filter (сданный/строительство)
            if filters.get('building_released'):
                from datetime import datetime
                current_year = datetime.now().year
                
                # Build conditions for each status
                release_conditions = []
                for status in filters['building_released']:
                    # Support both true/false (from HTML checkboxes) and Russian strings
                    if status in ['true', 'True', 'сданный']:
                        # Already completed: end_build_year <= current_year
                        release_conditions.append(ResidentialComplex.end_build_year <= current_year)
                    elif status in ['false', 'False', 'в строительстве']:
                        # Under construction: end_build_year > current_year
                        release_conditions.append(ResidentialComplex.end_build_year > current_year)
                
                # Apply OR condition if multiple statuses selected
                if release_conditions:
                    query = query.filter(or_(*release_conditions))
            
            # Deal type
            if filters.get('deal_type'):
                query = query.filter(Property.deal_type == filters['deal_type'])
            
            # Property type (apartments/houses/townhouses/penthouses/apartments_commercial)
            if filters.get('property_type') and filters['property_type'] != 'all':
                query = query.filter(Property.property_type == filters['property_type'])
            
            # Search query (search in title, address, complex name, geocoded fields)
            if filters.get('search'):
                # Стоп-слова которые не несут смысловой нагрузки для поиска
                stop_words = {'улица', 'ул', 'район', 'р-н', 'город', 'г', 'жк', 'жилой', 'комплекс', 'дом', 'д', 'корпус', 'к', 'строение', 'стр', 'литер', 'лит'}
                
                # Разбить на слова, убрать стоп-слова и короткие слова
                raw_words = filters['search'].replace('"', '').replace("'", '').split()
                search_words = [w for w in raw_words if w.lower() not in stop_words and len(w) > 1]
                
                if search_words:
                    # Создаём фильтр: каждое слово должно присутствовать хотя бы в одном из полей
                    for word in search_words:
                        search_term = f"%{word}%"
                        query = query.filter(
                            or_(
                                Property.title.ilike(search_term),
                                Property.address.ilike(search_term),
                                ResidentialComplex.name.ilike(search_term),
                                Developer.name.ilike(search_term),
                                District.name.ilike(search_term),
                                Property.parsed_city.ilike(search_term),
                                Property.parsed_district.ilike(search_term),
                                Property.parsed_street.ilike(search_term),
                                Property.parsed_area.ilike(search_term),
                                Property.parsed_settlement.ilike(search_term),
                                Property.parsed_house.ilike(search_term),
                                Property.parsed_block.ilike(search_term)
                            )
                        )
        
        # Apply sorting
        if sort_by == 'price':
            query = query.order_by(Property.price.desc() if sort_order == 'desc' else Property.price.asc())
        elif sort_by == 'area':
            query = query.order_by(Property.area.desc() if sort_order == 'desc' else Property.area.asc())
        elif sort_by == 'date':
            query = query.order_by(Property.created_at.desc() if sort_order == 'desc' else Property.created_at.asc())
        else:
            # Default sort by price ascending
            query = query.order_by(Property.price.asc())
        
        return query.offset(offset).limit(limit).all()
    
    @staticmethod
    def count_active(filters=None):
        """Подсчет активных квартир с фильтрами - ПОЛНАЯ ПОДДЕРЖКА build_property_filters() + кэширование 5 минут"""
        # Try to get from cache first
        cache_key = PropertyRepository._make_cache_key_for_filters(filters)
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            print(f"✅ REPO count_active CACHE HIT for filters={filters}")
            return cached_result
        
        print(f"🔍 REPO count_active CACHE MISS for filters={filters}")
        # Need to join tables for filter support
        query = (
            db.session.query(func.count(Property.id))
            .join(ResidentialComplex, Property.complex_id == ResidentialComplex.id, isouter=True)
            .join(Developer, Property.developer_id == Developer.id, isouter=True)
            .join(District, Property.district_id == District.id, isouter=True)
            .filter(Property.is_active == True)
        )
        
        if filters:
            # Price filters
            if filters.get('min_price'):
                query = query.filter(Property.price >= filters['min_price'])
            if filters.get('max_price'):
                query = query.filter(Property.price <= filters['max_price'])
            
            # Area filters
            if filters.get('min_area'):
                query = query.filter(Property.area >= filters['min_area'])
            if filters.get('max_area'):
                query = query.filter(Property.area <= filters['max_area'])
            
            # Rooms
            if filters.get('rooms'):
                room_values = []
                for r in filters['rooms']:
                    try:
                        room_values.append(int(r))
                    except (ValueError, TypeError):
                        pass
                if room_values:
                    query = query.filter(Property.rooms.in_(room_values))
            
            # Floor filters
            if filters.get('floor_min'):
                query = query.filter(Property.floor >= filters['floor_min'])
            if filters.get('floor_max'):
                query = query.filter(Property.floor <= filters['floor_max'])
            if filters.get('floor_options'):
                for option in filters['floor_options']:
                    if option == 'not_first':
                        query = query.filter(Property.floor > 1)
                    elif option == 'not_last':
                        query = query.filter(Property.floor < Property.total_floors)
                    elif option == 'last':
                        query = query.filter(Property.floor == Property.total_floors)
            
            # Complex/Developer/District filters
            if filters.get('complex_id'):
                query = query.filter(Property.complex_id == filters['complex_id'])
            if filters.get('residential_complex'):
                query = query.filter(ResidentialComplex.name == filters['residential_complex'])
            if filters.get('developer_id'):
                query = query.filter(Property.developer_id == filters['developer_id'])
            if filters.get('developer'):
                query = query.filter(Developer.name == filters['developer'])
            if filters.get('developers'):
                # Filter by developer IDs or names
                developer_ids = []
                developer_names = []
                for dev_value in filters['developers']:
                    if isinstance(dev_value, str) and dev_value.strip():
                        # Check if it's numeric ID or text name
                        if dev_value.strip().isdigit():
                            developer_ids.append(int(dev_value.strip()))
                        else:
                            developer_names.append(dev_value.strip())
                    elif isinstance(dev_value, int):
                        developer_ids.append(dev_value)
                
                # Apply filters
                conditions = []
                if developer_ids:
                    conditions.append(Property.developer_id.in_(developer_ids))
                if developer_names:
                    conditions.append(Developer.name.in_(developer_names))
                
                if conditions:
                    query = query.filter(or_(*conditions))
            
            # District filters - OR conditions for comprehensive district search
            # Searches across: District relation, parsed_district, parsed_settlement, parsed_area
            if filters.get('district'):
                district_name = filters['district'].strip() if filters['district'] else ''
                # Ignore empty district names to prevent matching everything
                if district_name:
                    query = query.filter(
                        or_(
                            and_(District.name.isnot(None), District.name.ilike(f'%{district_name}%')),
                            and_(Property.parsed_district.isnot(None), Property.parsed_district.ilike(f'%{district_name}%')),
                            and_(Property.parsed_settlement.isnot(None), Property.parsed_settlement.ilike(f'%{district_name}%')),
                            and_(Property.parsed_area.isnot(None), Property.parsed_area.ilike(f'%{district_name}%'))
                        )
                    )
            if filters.get('districts'):
                # Multiple districts - each district creates an OR condition across all fields
                district_conditions = []
                for district_name in filters['districts']:
                    district_conditions.append(
                        or_(
                            District.name.ilike(f'%{district_name}%'),
                            Property.parsed_district.ilike(f'%{district_name}%'),
                            Property.parsed_settlement.ilike(f'%{district_name}%'),
                            Property.parsed_area.ilike(f'%{district_name}%')
                        )
                    )
                if district_conditions:
                    query = query.filter(or_(*district_conditions))
            
            # Building filters
            if filters.get('building'):
                query = query.filter(Property.complex_building_name == filters['building'])
            if filters.get('building_floors_min'):
                query = query.filter(Property.total_floors >= filters['building_floors_min'])
            if filters.get('building_floors_max'):
                query = query.filter(Property.total_floors <= filters['building_floors_max'])
            if filters.get('building_types'):
                query = query.filter(Property.building_type.in_(filters['building_types']))
            
            # Delivery/completion years (через ResidentialComplex.end_build_year)
            if filters.get('build_year_min'):
                query = query.filter(ResidentialComplex.end_build_year >= filters['build_year_min'])
            if filters.get('build_year_max'):
                query = query.filter(ResidentialComplex.end_build_year <= filters['build_year_max'])
            if filters.get('delivery_years'):
                query = query.filter(ResidentialComplex.end_build_year.in_(filters['delivery_years']))
            
            # Features
            if filters.get('cashback_only'):
                query = query.filter(ResidentialComplex.cashback_rate > 0)
            if filters.get('renovation'):
                query = query.filter(Property.renovation_type.in_(filters['renovation']))
            if filters.get('object_classes'):
                query = query.filter(ResidentialComplex.object_class_display_name.in_(filters['object_classes']))
            
            # Ипотека и финансы (новые фильтры)
            if filters.get('features'):
                for feature in filters['features']:
                    if feature == 'accreditation':
                        query = query.filter(ResidentialComplex.has_accreditation == True)
                    elif feature == 'green_mortgage':
                        query = query.filter(ResidentialComplex.has_green_mortgage == True)
            
            # Срок сдачи (completion years: 2024, 2025, 2026, etc.)
            if filters.get('completion'):
                completion_years = []
                for year_str in filters['completion']:
                    try:
                        completion_years.append(int(year_str))
                    except (ValueError, TypeError):
                        pass
                if completion_years:
                    query = query.filter(ResidentialComplex.end_build_year.in_(completion_years))
            
            # Building released filter (сданный/строительство)
            if filters.get('building_released'):
                from datetime import datetime
                current_year = datetime.now().year
                
                release_conditions = []
                for status in filters['building_released']:
                    # Support both true/false (from HTML checkboxes) and Russian strings
                    if status in ['true', 'True', 'сданный']:
                        release_conditions.append(ResidentialComplex.end_build_year <= current_year)
                    elif status in ['false', 'False', 'в строительстве']:
                        release_conditions.append(ResidentialComplex.end_build_year > current_year)
                
                if release_conditions:
                    query = query.filter(or_(*release_conditions))
            
            if filters.get('deal_type'):
                query = query.filter(Property.deal_type == filters['deal_type'])
            
            # Property type (apartments/houses/townhouses/penthouses/apartments_commercial)
            if filters.get('property_type') and filters['property_type'] != 'all':
                query = query.filter(Property.property_type == filters['property_type'])
            
            # Search
            if filters.get('search'):
                # Стоп-слова которые не несут смысловой нагрузки для поиска
                stop_words = {'улица', 'ул', 'район', 'р-н', 'город', 'г', 'жк', 'жилой', 'комплекс', 'дом', 'д', 'корпус', 'к', 'строение', 'стр', 'литер', 'лит'}
                
                # Разбить на слова, убрать стоп-слова и короткие слова
                raw_words = filters['search'].replace('"', '').replace("'", '').split()
                search_words = [w for w in raw_words if w.lower() not in stop_words and len(w) > 1]
                
                if search_words:
                    for word in search_words:
                        search_term = f"%{word}%"
                        query = query.filter(
                            or_(
                                Property.title.ilike(search_term),
                                Property.address.ilike(search_term),
                                ResidentialComplex.name.ilike(search_term),
                                Developer.name.ilike(search_term),
                                District.name.ilike(search_term),
                                Property.parsed_city.ilike(search_term),
                                Property.parsed_district.ilike(search_term),
                                Property.parsed_street.ilike(search_term),
                                Property.parsed_area.ilike(search_term),
                                Property.parsed_settlement.ilike(search_term),
                                Property.parsed_house.ilike(search_term),
                                Property.parsed_block.ilike(search_term)
                            )
                        )
            
            # ⚠️ CRITICAL FIX: City filtering
            if filters.get('city_id'):
                query = query.filter(Property.city_id == filters['city_id'])
        
        # Execute query and cache result
        result = query.scalar()
        cache.set(cache_key, result, timeout=300)  # Cache for 5 minutes
        return result
    
    @staticmethod
    def get_filtered_count(**filters):
        """Алиас для count_active - для совместимости с API endpoint"""
        return PropertyRepository.count_active(filters=filters)


    @staticmethod
    def get_by_id(property_id):
        """Получить квартиру по ID с подгруженными связями"""
        return PropertyRepository.get_base_query().filter(Property.id == property_id).first()
    
    @staticmethod
    def get_by_ids_batch(property_ids):
        """
        Batch load properties by IDs in a single query with all relations preloaded
        Returns dict {property_id: Property} for fast lookup
        
        Args:
            property_ids: List of property IDs to load
        
        Returns:
            dict: {property_id: Property object with relations loaded}
        """
        if not property_ids:
            return {}
        
        # Use base query which includes all joins and eager loading
        properties = (
            PropertyRepository.get_base_query()
            .filter(Property.id.in_(property_ids))
            .all()
        )
        
        # Return as dict for fast lookups
        return {prop.id: prop for prop in properties}
    
    @staticmethod
    def get_by_inner_id(inner_id):
        """Получить квартиру по legacy inner_id (для обратной совместимости)"""
        return PropertyRepository.get_base_query().filter(Property.inner_id == str(inner_id)).first()
    
    @staticmethod
    def get_by_inner_ids(inner_ids):
        """
        Batch load properties by inner_ids (для обратной совместимости с legacy данными)
        Returns dict {inner_id: Property} for fast lookup
        """
        if not inner_ids:
            return {}
        
        # Convert all to strings
        inner_ids_str = [str(iid) for iid in inner_ids]
        
        properties = (
            PropertyRepository.get_base_query()
            .filter(Property.inner_id.in_(inner_ids_str))
            .all()
        )
        
        # Return as dict for fast lookups
        return {str(prop.inner_id): prop for prop in properties}
    
    @staticmethod
    def get_price_range():
        """Получить мин/макс цены"""
        result = db.session.query(
            func.min(Property.price),
            func.max(Property.price)
        ).filter(Property.is_active == True).first()
        
        return {
            'min_price': result[0] or 0,
            'max_price': result[1] or 0
        }
    
    @staticmethod
    def get_properties_with_coordinates():
        """Получить все квартиры с координатами для карты"""
        from models import Developer
        return (
            db.session.query(
                Property.id,
                Property.inner_id,
                Property.title,
                Property.price,
                Property.rooms,
                Property.area,
                Property.floor,
                Property.total_floors,
                Property.main_image,
                Property.gallery_images,
                Property.latitude,
                Property.longitude,
                ResidentialComplex.name.label('complex_name'),
                ResidentialComplex.cashback_rate,
                Developer.name.label('developer_name')
            )
            .join(ResidentialComplex, Property.complex_id == ResidentialComplex.id)
            .outerjoin(Developer, ResidentialComplex.developer_id == Developer.id)
            .filter(
                Property.is_active == True,
                Property.latitude.isnot(None),
                Property.longitude.isnot(None)
            )
            .all()
        )
    
    @staticmethod
    def get_featured_properties(limit=6):
        """Получить избранные/рекомендуемые квартиры"""
        return (
            PropertyRepository.get_base_query()
            .filter(Property.is_active == True)
            .order_by(Property.price.desc())
            .limit(limit)
            .all()
        )
    
    @staticmethod
    def get_by_complex_id(complex_id, limit=50, sort_by='price', sort_order='desc'):
        """Получить квартиры по ID ЖК с сортировкой"""
        query = PropertyRepository.get_base_query().filter(Property.complex_id == complex_id, Property.is_active == True)
        
        # Apply sorting
        if sort_by == 'price':
            query = query.order_by(Property.price.desc() if sort_order == 'desc' else Property.price.asc())
        elif sort_by == 'area':
            query = query.order_by(Property.area.desc() if sort_order == 'desc' else Property.area.asc())
        
        return query.limit(limit).all()
    
    @staticmethod
    def get_all_property_stats(city_id=None):
        """
        Получить статистику квартир для всех ЖК одним запросом (избегает N+1) + кэширование 5 минут
        
        Args:
            city_id: Optional integer - filter properties by city_id
        
        Returns:
            dict: {complex_id: {stats}} - statistics for each complex
        """
        # Try to get from cache first
        cache_key = PropertyRepository._make_stats_cache_key(city_id)
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            print(f"✅ REPO get_all_property_stats CACHE HIT for city_id={city_id}")
            return cached_result
        
        print(f"🔍 REPO get_all_property_stats CACHE MISS for city_id={city_id}")
        # Основная статистика (цены, площади, адреса)
        stats_query = db.session.query(
            Property.complex_id,
            func.count(Property.id).label('total'),
            func.min(Property.price).label('min_price'),
            func.max(Property.price).label('max_price'),
            func.avg(Property.price).label('avg_price'),
            func.min(Property.area).label('min_area'),
            func.max(Property.area).label('max_area'),
            func.max(Property.address).label('sample_address')
        ).filter(Property.is_active == True)
        
        # Add city filter if provided
        if city_id:
            stats_query = stats_query.join(
                ResidentialComplex, Property.complex_id == ResidentialComplex.id
            ).filter(ResidentialComplex.city_id == city_id)
        
        stats_query = stats_query.group_by(Property.complex_id).all()
        
        # Подсчет уникальных корпусов по complex_building_name для каждого ЖК
        buildings_query = db.session.query(
            Property.complex_id,
            func.count(func.distinct(Property.complex_building_name)).label('buildings_count')
        ).filter(
            Property.is_active == True,
            Property.complex_building_name.isnot(None)
        )
        
        # Add city filter if provided
        if city_id:
            buildings_query = buildings_query.join(
                ResidentialComplex, Property.complex_id == ResidentialComplex.id
            ).filter(ResidentialComplex.city_id == city_id)
        
        buildings_query = buildings_query.group_by(Property.complex_id).all()
        
        buildings_dict = {row.complex_id: max(row.buildings_count, 1) for row in buildings_query}
        
        # Получаем первое фото из свойств для каждого ЖК (fallback если у ЖК нет собственных фото)
        photos_query = db.session.query(
            Property.complex_id,
            func.min(Property.gallery_images).label('sample_photos')
        ).filter(
            Property.is_active == True,
            Property.gallery_images.isnot(None),
            Property.gallery_images != '[]'
        )
        
        # Add city filter if provided
        if city_id:
            photos_query = photos_query.join(
                ResidentialComplex, Property.complex_id == ResidentialComplex.id
            ).filter(ResidentialComplex.city_id == city_id)
        
        photos_query = photos_query.group_by(Property.complex_id).all()
        
        photos_dict = {}
        for row in photos_query:
            try:
                photos_raw = json.loads(row.sample_photos) if isinstance(row.sample_photos, str) else row.sample_photos
                if photos_raw and isinstance(photos_raw, list) and len(photos_raw) > 1:
                    # Пропускаем первое фото (индекс 0), берем со 2-го по 4-е (индексы 1,2,3)
                    photos_dict[row.complex_id] = photos_raw[1:4]
            except:
                pass
        
        stats_dict = {}
        for row in stats_query:
            stats_dict[row.complex_id] = {
                'total_count': row.total or 0,
                'total_properties': row.total or 0,
                'min_price': int(row.min_price) if row.min_price else 0,
                'max_price': int(row.max_price) if row.max_price else 0,
                'avg_price': int(row.avg_price) if row.avg_price else 0,
                'min_area': float(row.min_area) if row.min_area else 0,
                'max_area': float(row.max_area) if row.max_area else 0,
                'sample_address': row.sample_address if hasattr(row, 'sample_address') else None,
                'buildings_count': buildings_dict.get(row.complex_id, 1),  # Default 1 if no buildings
                'sample_photos': photos_dict.get(row.complex_id, []),  # Photos from properties
                'room_distribution': {},
                'room_details': {}  # Детальная статистика по типам комнат
            }
        
        # Детальная статистика по комнатам для каждого ЖК (с ценами и площадями)
        room_query = db.session.query(
            Property.complex_id,
            Property.rooms,
            func.count(Property.id).label('count'),
            func.min(Property.price).label('min_price'),
            func.max(Property.price).label('max_price'),
            func.min(Property.area).label('min_area'),
            func.max(Property.area).label('max_area')
        ).filter(Property.is_active == True)
        
        # Add city filter if provided
        if city_id:
            room_query = room_query.join(
                ResidentialComplex, Property.complex_id == ResidentialComplex.id
            ).filter(ResidentialComplex.city_id == city_id)
        
        room_query = room_query.group_by(Property.complex_id, Property.rooms).all()
        
        # Добавляем room distribution и room_details к статистике
        for row in room_query:
            complex_id = row.complex_id
            rooms = row.rooms or 0
            count = row.count
            
            if complex_id in stats_dict:
                room_type = f"{rooms}-комн" if rooms and rooms > 0 else "Студия"
                
                # Простой подсчет количества
                stats_dict[complex_id]['room_distribution'][room_type] = count
                
                # Детальная статистика с ценами и площадями
                stats_dict[complex_id]['room_details'][room_type] = {
                    'count': count,
                    'price_from': int(row.min_price) if row.min_price else 0,
                    'price_to': int(row.max_price) if row.max_price else 0,
                    'area_from': round(float(row.min_area), 1) if row.min_area else 0,
                    'area_to': round(float(row.max_area), 1) if row.max_area else 0
                }
        
        # Cache the result for 5 minutes
        cache.set(cache_key, stats_dict, timeout=300)
        return stats_dict
    
    @staticmethod
    def get_filtered_property_stats(price_min=None, price_max=None, rooms=None, area_min=None, area_max=None):
        """Получить статистику квартир для ЖК с учетом фильтров (избегает N+1)"""
        import json
        
        # Базовый фильтр
        base_filter = Property.is_active == True
        
        # Построение дополнительных фильтров
        filters = [base_filter]
        
        if price_min:
            filters.append(Property.price >= price_min)
        if price_max:
            filters.append(Property.price <= price_max)
        if rooms and len(rooms) > 0:
            filters.append(Property.rooms.in_(rooms))
        if area_min:
            filters.append(Property.area >= area_min)
        if area_max:
            filters.append(Property.area <= area_max)
        
        # Основная статистика (цены, площади, адреса)
        stats_query = (
            db.session.query(
                Property.complex_id,
                func.count(Property.id).label('total'),
                func.min(Property.price).label('min_price'),
                func.max(Property.price).label('max_price'),
                func.avg(Property.price).label('avg_price'),
                func.min(Property.area).label('min_area'),
                func.max(Property.area).label('max_area'),
                func.max(Property.address).label('sample_address')
            )
            .filter(*filters)
            .group_by(Property.complex_id)
            .all()
        )
        
        # Подсчет уникальных корпусов по complex_building_name для каждого ЖК
        buildings_query = (
            db.session.query(
                Property.complex_id,
                func.count(func.distinct(Property.complex_building_name)).label('buildings_count')
            )
            .filter(
                *filters,
                Property.complex_building_name.isnot(None)
            )
            .group_by(Property.complex_id)
            .all()
        )
        
        buildings_dict = {row.complex_id: max(row.buildings_count, 1) for row in buildings_query}
        
        # Получаем первое фото из свойств для каждого ЖК (fallback если у ЖК нет собственных фото)
        photos_query = (
            db.session.query(
                Property.complex_id,
                func.min(Property.gallery_images).label('sample_photos')
            )
            .filter(
                *filters,
                Property.gallery_images.isnot(None),
                Property.gallery_images != '[]'
            )
            .group_by(Property.complex_id)
            .all()
        )
        
        photos_dict = {}
        for row in photos_query:
            try:
                photos_raw = json.loads(row.sample_photos) if isinstance(row.sample_photos, str) else row.sample_photos
                if photos_raw and isinstance(photos_raw, list) and len(photos_raw) > 1:
                    # Пропускаем первое фото (индекс 0), берем со 2-го по 4-е (индексы 1,2,3)
                    photos_dict[row.complex_id] = photos_raw[1:4]
            except:
                pass
        
        stats_dict = {}
        for row in stats_query:
            stats_dict[row.complex_id] = {
                'total_count': row.total or 0,
                'total_properties': row.total or 0,
                'min_price': int(row.min_price) if row.min_price else 0,
                'max_price': int(row.max_price) if row.max_price else 0,
                'avg_price': int(row.avg_price) if row.avg_price else 0,
                'min_area': float(row.min_area) if row.min_area else 0,
                'max_area': float(row.max_area) if row.max_area else 0,
                'sample_address': row.sample_address if hasattr(row, 'sample_address') else None,
                'buildings_count': buildings_dict.get(row.complex_id, 1),  # Default 1 if no buildings
                'sample_photos': photos_dict.get(row.complex_id, []),  # Photos from properties
                'room_distribution': {},
                'room_details': {}  # Детальная статистика по типам комнат
            }
        
        # Детальная статистика по комнатам для каждого ЖК (с ценами и площадями)
        room_query = (
            db.session.query(
                Property.complex_id,
                Property.rooms,
                func.count(Property.id).label('count'),
                func.min(Property.price).label('min_price'),
                func.max(Property.price).label('max_price'),
                func.min(Property.area).label('min_area'),
                func.max(Property.area).label('max_area')
            )
            .filter(*filters)
            .group_by(Property.complex_id, Property.rooms)
            .all()
        )
        
        # Добавляем room distribution и room_details к статистике
        for row in room_query:
            complex_id = row.complex_id
            rooms = row.rooms or 0
            count = row.count
            
            if complex_id in stats_dict:
                room_type = f"{rooms}-комн" if rooms and rooms > 0 else "Студия"
                
                # Простой подсчет количества
                stats_dict[complex_id]['room_distribution'][room_type] = count
                
                # Детальная статистика с ценами и площадями
                stats_dict[complex_id]['room_details'][room_type] = {
                    'count': count,
                    'price_from': int(row.min_price) if row.min_price else 0,
                    'price_to': int(row.max_price) if row.max_price else 0,
                    'area_from': round(float(row.min_area), 1) if row.min_area else 0,
                    'area_to': round(float(row.max_area), 1) if row.max_area else 0
                }
        
        return stats_dict


class ResidentialComplexRepository:
    """Repository для работы с жилыми комплексами"""
    
    @staticmethod
    def get_base_query():
        """Базовый query с JOIN застройщика"""
        return (
            db.session.query(ResidentialComplex)
            .join(Developer, ResidentialComplex.developer_id == Developer.id, isouter=True)
            .options(joinedload(ResidentialComplex.developer))
        )
    
    @staticmethod
    def get_all_active(limit=50, offset=0, city_id=None):
        """
        Получить все активные ЖК
        
        Args:
            limit: Максимальное количество ЖК
            offset: Смещение для пагинации
            city_id: Опциональный ID города для фильтрации
        """
        query = (
            ResidentialComplexRepository.get_base_query()
            .filter(ResidentialComplex.is_active == True)
        )
        
        # Add city filter if provided
        if city_id:
            query = query.filter(ResidentialComplex.city_id == city_id)
        
        return query.offset(offset).limit(limit).all()
    
    @staticmethod
    def get_by_id(complex_id):
        """Получить ЖК по ID"""
        return ResidentialComplexRepository.get_base_query().filter(ResidentialComplex.id == complex_id).first()
    
    @staticmethod
    def get_by_slug(slug):
        """Получить ЖК по slug"""
        return ResidentialComplexRepository.get_base_query().filter(ResidentialComplex.slug == slug).first()
    
    @staticmethod
    def count_active():
        """Подсчет активных ЖК"""
        return db.session.query(func.count(ResidentialComplex.id)).filter(ResidentialComplex.is_active == True).scalar()
    
    @staticmethod
    def get_with_coordinates():
        """Получить ЖК с координатами для карты"""
        return (
            db.session.query(
                ResidentialComplex.id,
                ResidentialComplex.name,
                ResidentialComplex.slug,
                ResidentialComplex.latitude,
                ResidentialComplex.longitude,
                ResidentialComplex.cashback_rate,
                ResidentialComplex.main_image,
                ResidentialComplex.end_build_year,
                ResidentialComplex.end_build_quarter,
                ResidentialComplex.object_class_display_name,
                Developer.name.label('developer_name')
            )
            .join(Developer, ResidentialComplex.developer_id == Developer.id, isouter=True)
            .filter(
                ResidentialComplex.is_active == True,
                ResidentialComplex.latitude.isnot(None),
                ResidentialComplex.longitude.isnot(None)
            )
            .all()
        )
    
    @staticmethod
    def get_property_stats(complex_id):
        """Получить статистику квартир в ЖК"""
        stats = (
            db.session.query(
                func.count(Property.id).label('total'),
                func.min(Property.price).label('min_price'),
                func.max(Property.price).label('max_price'),
                func.avg(Property.price).label('avg_price')
            )
            .filter(
                Property.complex_id == complex_id,
                Property.is_active == True
            )
            .first()
        )
        
        return {
            'total_properties': stats.total or 0,
            'min_price': int(stats.min_price) if stats.min_price else 0,
            'max_price': int(stats.max_price) if stats.max_price else 0,
            'avg_price': int(stats.avg_price) if stats.avg_price else 0
        }
    


class DeveloperRepository:
    """Repository для работы с застройщиками"""
    
    @staticmethod
    def get_all_active():
        """Получить всех активных застройщиков"""
        return Developer.query.filter_by(is_active=True).all()
    
    @staticmethod
    def get_by_id(developer_id):
        """Получить застройщика по ID"""
        return Developer.query.filter_by(id=developer_id).first()
    
    @staticmethod
    def get_by_slug(slug):
        """Получить застройщика по slug"""
        return Developer.query.filter_by(slug=slug).first()
    
    @staticmethod
    def get_with_stats():
        """Получить застройщиков со статистикой ЖК и квартир"""
        return (
            db.session.query(
                Developer,
                func.count(ResidentialComplex.id.distinct()).label('complexes_count'),
                func.count(Property.id).label('properties_count')
            )
            .outerjoin(ResidentialComplex, Developer.id == ResidentialComplex.developer_id)
            .outerjoin(Property, Developer.id == Property.developer_id)
            .filter(Developer.is_active == True)
            .group_by(Developer.id)
            .all()
        )

class DistrictRepository:
    """Repository для работы с районами"""
    
    @staticmethod
    def get_all_active():
        """Получить все районы"""
        return District.query.order_by(District.name).all()
    
    @staticmethod
    def get_by_id(district_id):
        """Получить район по ID"""
        return District.query.filter_by(id=district_id).first()
    
    @staticmethod
    def get_by_slug(slug):
        """Получить район по slug"""
        return District.query.filter_by(slug=slug).first()
