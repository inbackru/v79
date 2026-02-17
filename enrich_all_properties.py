#!/usr/bin/env python3
"""
Batch enrich all properties with parsed address components
Updates all properties that have coordinates but missing parsed fields
"""

from services.geocoding import get_geocoding_service
from app import app, db
from models import Property
import time


def enrich_all_properties(batch_size=50, delay=0.1):
    """
    Enrich all properties with parsed address data
    
    Args:
        batch_size: Number of properties to process in one batch
        delay: Delay between API requests in seconds (to avoid rate limiting)
    """
    
    with app.app_context():
        service = get_geocoding_service()
        
        print("=" * 80)
        print("МАССОВОЕ ОБОГАЩЕНИЕ АДРЕСОВ")
        print("=" * 80)
        
        # Find properties with coordinates but missing parsed data
        total_properties = Property.query.filter(
            Property.latitude.isnot(None),
            Property.longitude.isnot(None)
        ).count()
        
        print(f"\nВсего объектов с координатами: {total_properties}")
        
        # Process in batches
        processed = 0
        updated = 0
        errors = 0
        
        while processed < total_properties:
            properties = Property.query.filter(
                Property.latitude.isnot(None),
                Property.longitude.isnot(None)
            ).limit(batch_size).offset(processed).all()
            
            if not properties:
                break
            
            print(f"\n{'='*80}")
            print(f"ПАКЕТ {processed//batch_size + 1}: Обработка {len(properties)} объектов...")
            print(f"{'='*80}")
            
            for i, prop in enumerate(properties, 1):
                try:
                    print(f"\n[{processed + i}/{total_properties}] {prop.title}")
                    print(f"   Координаты: {prop.latitude}, {prop.longitude}")
                    
                    # Get enriched address
                    enriched = service.enrich_property_address(
                        prop.latitude, 
                        prop.longitude
                    )
                    
                    if enriched:
                        # Update fields
                        old_city = prop.parsed_city
                        old_district = prop.parsed_district
                        old_street = prop.parsed_street
                        
                        prop.parsed_city = enriched.get('parsed_city', '')
                        prop.parsed_district = enriched.get('parsed_district', '')
                        prop.parsed_street = enriched.get('parsed_street', '')
                        
                        # Show what changed
                        changes = []
                        if old_city != prop.parsed_city:
                            changes.append(f"city: '{old_city or ''}' → '{prop.parsed_city}'")
                        if old_district != prop.parsed_district:
                            changes.append(f"district: '{old_district or ''}' → '{prop.parsed_district}'")
                        if old_street != prop.parsed_street:
                            changes.append(f"street: '{old_street or ''}' → '{prop.parsed_street}'")
                        
                        if changes:
                            print(f"   ✅ Обновлено: {', '.join(changes)}")
                            updated += 1
                        else:
                            print(f"   ⏭️  Без изменений")
                        
                        # Small delay to avoid rate limiting
                        time.sleep(delay)
                        
                    else:
                        print(f"   ⚠️  Не удалось получить адрес")
                        errors += 1
                    
                except Exception as e:
                    print(f"   ❌ Ошибка: {e}")
                    errors += 1
            
            # Commit batch
            try:
                db.session.commit()
                print(f"\n✅ Пакет сохранён в базу данных")
            except Exception as e:
                db.session.rollback()
                print(f"\n❌ Ошибка сохранения: {e}")
            
            processed += len(properties)
        
        # Show final statistics
        print(f"\n{'='*80}")
        print("ИТОГОВАЯ СТАТИСТИКА")
        print(f"{'='*80}")
        print(f"Всего обработано: {processed}")
        print(f"Обновлено: {updated}")
        print(f"Ошибок: {errors}")
        
        stats = service.get_stats()
        print(f"\nAPI запросов: {stats['api_requests']}")
        print(f"Попаданий в кэш: {stats['cache_hits']}")
        print(f"Процент попаданий: {stats['cache_hit_rate']}")
        
        print(f"\n{'='*80}")
        print("ОБОГАЩЕНИЕ ЗАВЕРШЕНО")
        print(f"{'='*80}\n")


if __name__ == "__main__":
    # Process all properties with small delay between requests
    enrich_all_properties(batch_size=50, delay=0.1)
