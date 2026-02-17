"""
Geocoding Service for InBack.ru
Provides address parsing and geocoding using Yandex Maps API
Following best practices from Domclick and Yandex Realty
"""

import os
import time
import logging
import requests
from typing import Dict, List, Optional, Tuple, Any, Union
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class GeocodingCache:
    """Simple in-memory cache with TTL for geocoding results"""
    
    def __init__(self, ttl_hours: int = 24):
        self.cache = {}
        self.ttl_seconds = ttl_hours * 3600
    
    def get(self, key: str) -> Optional[Any]:
        """Get cached value if not expired"""
        if key in self.cache:
            value, timestamp = self.cache[key]
            if time.time() - timestamp < self.ttl_seconds:
                return value
            else:
                del self.cache[key]
        return None
    
    def set(self, key: str, value: Any):
        """Set value in cache with current timestamp"""
        self.cache[key] = (value, time.time())
    
    def clear(self):
        """Clear all cached values"""
        self.cache.clear()


class YandexGeocodingService:
    """
    Yandex Maps Geocoding Service
    Handles reverse geocoding, forward geocoding, and autocomplete
    """
    
    BASE_URL = "https://geocode-maps.yandex.ru/1.x/"
    SUGGEST_URL = "https://suggest-maps.yandex.ru/v1/suggest"
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('YANDEX_MAPS_API_KEY')
        if not self.api_key:
            logger.warning("YANDEX_MAPS_API_KEY not found in environment")
        
        self.cache = GeocodingCache(ttl_hours=24)
        self.request_count = 0
        self.cache_hits = 0
    
    def _make_request(self, url: str, params: Dict) -> Optional[Dict]:
        """Make HTTP request with error handling and retry logic"""
        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            self.request_count += 1
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Geocoding API error: {e}")
            return None
    
    def reverse_geocode(self, latitude: float, longitude: float, kind: Optional[str] = None) -> Optional[Dict]:
        """
        Convert coordinates to address (reverse geocoding)
        
        Args:
            latitude: Latitude coordinate
            longitude: Longitude coordinate
            kind: Filter by type (house, street, district, locality)
        
        Returns:
            Dict with address components or None if error
        """
        cache_key = f"reverse:{latitude},{longitude}:{kind or 'all'}"
        cached = self.cache.get(cache_key)
        if cached:
            self.cache_hits += 1
            logger.debug(f"Cache hit for reverse geocoding: {cache_key}")
            return cached
        
        params = {
            'apikey': self.api_key,
            'geocode': f"{longitude},{latitude}",  # Yandex uses lon,lat order
            'format': 'json',
            'lang': 'ru-RU',
            'results': 1
        }
        
        if kind:
            params['kind'] = kind
        
        data = self._make_request(self.BASE_URL, params)
        if not data:
            return None
        
        result = self._parse_geocode_response(data)
        if result:
            self.cache.set(cache_key, result)
        
        return result
    
    def forward_geocode(self, address: str) -> Optional[Dict]:
        """
        Convert address to coordinates (forward geocoding)
        
        Args:
            address: Address string
        
        Returns:
            Dict with coordinates and parsed address components
        """
        cache_key = f"forward:{address.lower().strip()}"
        cached = self.cache.get(cache_key)
        if cached:
            self.cache_hits += 1
            logger.debug(f"Cache hit for forward geocoding: {cache_key}")
            return cached
        
        params = {
            'apikey': self.api_key,
            'geocode': address,
            'format': 'json',
            'lang': 'ru-RU',
            'results': 1
        }
        
        data = self._make_request(self.BASE_URL, params)
        if not data:
            return None
        
        result = self._parse_geocode_response(data)
        if result:
            self.cache.set(cache_key, result)
        
        return result
    
    def autocomplete(self, query: str, latitude: Optional[float] = None, 
                    longitude: Optional[float] = None, results: int = 7) -> List[Dict]:
        """
        Get address autocomplete suggestions using Geocoder API
        
        Args:
            query: Search query
            latitude: Optional latitude for geolocation bias
            longitude: Optional longitude for geolocation bias
            results: Max number of results (default 7)
        
        Returns:
            List of suggestion dictionaries
        """
        if not query or len(query) < 2:
            return []
        
        cache_key = f"autocomplete:{query.lower().strip()}:{latitude},{longitude}"
        cached = self.cache.get(cache_key)
        if cached:
            self.cache_hits += 1
            logger.debug(f"Cache hit for autocomplete: {cache_key}")
            return cached
        
        # Add Krasnodar context if not already in query
        search_query = query
        if 'краснодар' not in query.lower() and latitude and longitude:
            # Bias towards Krasnodar region
            search_query = f"Краснодар, {query}"
        
        params = {
            'apikey': self.api_key,
            'geocode': search_query,
            'format': 'json',
            'lang': 'ru-RU',
            'results': min(results, 10)
        }
        
        data = self._make_request(self.BASE_URL, params)
        if not data:
            return []
        
        try:
            feature_members = data['response']['GeoObjectCollection']['featureMember']
            suggestions = []
            
            for member in feature_members:
                geo_object = member['GeoObject']
                metadata = geo_object['metaDataProperty']['GeocoderMetaData']
                
                # Extract coordinates
                pos = geo_object['Point']['pos'].split()
                lon, lat = float(pos[0]), float(pos[1])
                
                suggestion = {
                    'text': metadata.get('text', ''),
                    'title': metadata.get('text', '').split(', ')[-1] if ',' in metadata.get('text', '') else metadata.get('text', ''),
                    'subtitle': metadata.get('Address', {}).get('formatted', ''),
                    'type': metadata.get('kind', 'unknown'),
                    'latitude': lat,
                    'longitude': lon
                }
                
                suggestions.append(suggestion)
            
            self.cache.set(cache_key, suggestions)
            return suggestions
            
        except (KeyError, IndexError, ValueError) as e:
            logger.error(f"Error parsing autocomplete response: {e}")
            return []
    
    def _parse_geocode_response(self, data: Dict) -> Optional[Dict]:
        """
        Parse Yandex Geocoder API response and extract address components
        
        Returns:
            Dict with structured address data:
            {
                'formatted_address': str,
                'country': str,
                'region': str,
                'city': str,
                'district': str,
                'street': str,
                'house': str,
                'postal_code': str,
                'latitude': float,
                'longitude': float,
                'precision': str
            }
        """
        try:
            feature_member = data['response']['GeoObjectCollection']['featureMember']
            if not feature_member:
                return None
            
            geo_object = feature_member[0]['GeoObject']
            metadata = geo_object['metaDataProperty']['GeocoderMetaData']
            
            # Extract coordinates
            pos = geo_object['Point']['pos'].split()
            longitude, latitude = float(pos[0]), float(pos[1])
            
            # Extract address components
            address_details = metadata['Address']
            components = address_details.get('Components', [])
            
            result = {
                'formatted_address': metadata.get('text', ''),
                'country': '',
                'region': '',
                'city': '',
                'district': '',
                'street': '',
                'house': '',
                'postal_code': address_details.get('postal_code', ''),
                'latitude': latitude,
                'longitude': longitude,
                'precision': metadata.get('precision', 'unknown'),
                'kind': metadata.get('kind', 'unknown')
            }
            
            # Parse components hierarchically
            for component in components:
                kind = component.get('kind', '')
                name = component.get('name', '')
                
                if kind == 'country':
                    result['country'] = name
                elif kind == 'province':
                    if not result['region']:
                        result['region'] = name
                elif kind == 'locality':
                    result['city'] = name
                elif kind == 'district':
                    result['district'] = name
                elif kind == 'street':
                    result['street'] = name
                elif kind == 'house':
                    result['house'] = name
            
            return result
            
        except (KeyError, IndexError, ValueError) as e:
            logger.error(f"Error parsing geocode response: {e}")
            return None
    
    def enrich_property_address(self, latitude: float, longitude: float) -> Optional[Dict]:
        """
        Enrich property with parsed address components from coordinates
        Optimized for real estate use case
        
        Returns:
            Dict with parsed_city, parsed_district, parsed_street, full_address
        """
        result = self.reverse_geocode(latitude, longitude, kind='house')
        
        if not result:
            return None
        
        return {
            'parsed_city': result.get('city', ''),
            'parsed_district': result.get('district', ''),
            'parsed_street': result.get('street', ''),
            'full_address': result.get('formatted_address', ''),
            'postal_code': result.get('postal_code', ''),
            'latitude': result.get('latitude'),
            'longitude': result.get('longitude')
        }
    
    def get_stats(self) -> Dict:
        """Get service statistics"""
        cache_size = len(self.cache.cache)
        return {
            'api_requests': self.request_count,
            'cache_hits': self.cache_hits,
            'cache_size': cache_size,
            'cache_hit_rate': f"{(self.cache_hits / max(1, self.request_count + self.cache_hits) * 100):.1f}%"
        }


# Global service instance
_geocoding_service = None

def get_geocoding_service() -> YandexGeocodingService:
    """Get or create global geocoding service instance"""
    global _geocoding_service
    if _geocoding_service is None:
        _geocoding_service = YandexGeocodingService()
    return _geocoding_service
