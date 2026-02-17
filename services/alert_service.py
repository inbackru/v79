import logging
from datetime import datetime, timedelta, date
from sqlalchemy import desc
import json
import jwt
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_db():
    """Lazy import to avoid circular dependency"""
    from app import db
    return db


class AlertService:
    """
    Service for managing property alerts and notifications
    Implements Zillow/Rightmove style notification system
    """
    
    INSTANT_ALERT_LIMIT = 15  # Maximum instant alerts per day per user
    
    @staticmethod
    def check_new_properties():
        """
        Check for new properties created in the last 5 minutes
        Returns list of new property IDs
        """
        from models import Property
        
        logger.info("🔍 Checking for new properties...")
        
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        
        new_properties = Property.query.filter(
            Property.created_at >= five_minutes_ago,
            Property.is_active == True,
            Property.status.in_(['Продается', 'В продаже'])
        ).all()
        
        logger.info(f"✅ Found {len(new_properties)} new properties")
        return new_properties
    
    @staticmethod
    def match_properties_to_searches(properties):
        """
        Match properties to saved searches with filters
        Returns dict: {saved_search_id: [property_ids]}
        """
        from models import SavedSearch
        
        logger.info(f"🔎 Matching {len(properties)} properties to saved searches...")
        
        matches = {}
        
        active_searches = SavedSearch.query.filter(
            SavedSearch.alert_enabled == True
        ).all()
        
        logger.info(f"Found {len(active_searches)} active saved searches with alerts")
        
        for search in active_searches:
            matching_properties = []
            
            for prop in properties:
                if AlertService._property_matches_search(prop, search):
                    matching_properties.append(prop)
            
            if matching_properties:
                matches[search.id] = matching_properties
                logger.info(f"  ✓ Search '{search.name}' matched {len(matching_properties)} properties")
        
        logger.info(f"✅ Total matches: {sum(len(props) for props in matches.values())} across {len(matches)} searches")
        return matches
    
    @staticmethod
    def _property_matches_search(property, search):
        """
        Check if a property matches saved search filters
        """
        # Check property type / rooms
        if search.property_type:
            if property.rooms is not None:
                search_rooms = AlertService._parse_rooms_from_type(search.property_type)
                if search_rooms is not None and property.rooms != search_rooms:
                    return False
        
        # Check price range
        if search.price_min is not None:
            if property.price is None or property.price < search.price_min:
                return False
        
        if search.price_max is not None:
            if property.price is None or property.price > search.price_max:
                return False
        
        # Check size/area range
        if search.size_min is not None:
            if property.area is None or property.area < search.size_min:
                return False
        
        if search.size_max is not None:
            if property.area is None or property.area > search.size_max:
                return False
        
        # Check developer
        if search.developer:
            if not property.developer or search.developer.lower() not in property.developer.name.lower():
                return False
        
        # Check complex name
        if search.complex_name:
            if not property.residential_complex or search.complex_name.lower() not in property.residential_complex.name.lower():
                return False
        
        # Check location (district, street, etc.)
        if search.location:
            location_match = False
            search_loc = search.location.lower()
            
            if property.district and search_loc in property.district.name.lower():
                location_match = True
            elif property.parsed_district and search_loc in property.parsed_district.lower():
                location_match = True
            elif property.parsed_street and search_loc in property.parsed_street.lower():
                location_match = True
            elif property.address and search_loc in property.address.lower():
                location_match = True
            
            if not location_match:
                return False
        
        return True
    
    @staticmethod
    def _parse_rooms_from_type(property_type):
        """Parse room count from property_type string"""
        if not property_type:
            return None
        
        if 'студия' in property_type.lower():
            return 0
        
        try:
            import re
            match = re.search(r'(\d+)', property_type)
            if match:
                return int(match.group(1))
        except:
            pass
        
        return None
    
    @staticmethod
    def send_instant_alerts():
        """
        Send instant alerts for new properties
        Respects rate limiting (max 15 per day per user)
        """
        from models import SavedSearch, User
        
        logger.info("⚡ Starting instant alerts processing...")
        
        new_properties = AlertService.check_new_properties()
        if not new_properties:
            logger.info("No new properties to alert about")
            return 0
        
        matches = AlertService.match_properties_to_searches(new_properties)
        if not matches:
            logger.info("No matches found for instant alerts")
            return 0
        
        alerts_sent = 0
        
        for search_id, properties in matches.items():
            search = SavedSearch.query.get(search_id)
            if not search or search.alert_frequency != 'instant':
                continue
            
            if not AlertService._can_send_instant_alert(search):
                logger.info(f"⚠️  Rate limit reached for search '{search.name}' (user {search.user_id})")
                continue
            
            user = User.query.get(search.user_id)
            if not user or not user.email_notifications:
                continue
            
            for prop in properties:
                if AlertService._already_alerted(search.id, prop.id, 'NEW_LISTING'):
                    continue
                
                success = AlertService._send_property_alert(
                    user=user,
                    search=search,
                    property=prop,
                    alert_type='NEW_LISTING',
                    frequency='instant'
                )
                
                if success:
                    alerts_sent += 1
                    AlertService._increment_daily_counter(search)
        
        logger.info(f"✅ Sent {alerts_sent} instant alerts")
        return alerts_sent
    
    @staticmethod
    def send_daily_digest():
        """Send daily digest for saved searches"""
        from models import SavedSearch, User, Property
        
        logger.info("📧 Starting daily digest sending...")
        
        yesterday = datetime.utcnow() - timedelta(days=1)
        
        new_properties = Property.query.filter(
            Property.created_at >= yesterday,
            Property.is_active == True,
            Property.status.in_(['Продается', 'В продаже'])
        ).all()
        
        if not new_properties:
            logger.info("No new properties for daily digest")
            return 0
        
        daily_searches = SavedSearch.query.filter(
            SavedSearch.alert_enabled == True,
            SavedSearch.alert_frequency == 'daily'
        ).all()
        
        digests_sent = 0
        
        for search in daily_searches:
            matching_props = [p for p in new_properties if AlertService._property_matches_search(p, search)]
            
            if not matching_props:
                continue
            
            user = User.query.get(search.user_id)
            if not user or not user.email_notifications:
                continue
            
            new_props = [p for p in matching_props if not AlertService._already_alerted(search.id, p.id, 'NEW_LISTING')]
            
            if new_props:
                success = AlertService._send_digest_email(
                    user=user,
                    search=search,
                    properties=new_props,
                    digest_type='daily'
                )
                
                if success:
                    for prop in new_props:
                        AlertService._create_alert_record(
                            search=search,
                            property=prop,
                            alert_type='NEW_LISTING',
                            frequency='daily',
                            channel='email'
                        )
                    digests_sent += 1
        
        logger.info(f"✅ Sent {digests_sent} daily digests")
        return digests_sent
    
    @staticmethod
    def send_weekly_digest():
        """Send weekly digest for saved searches"""
        from models import SavedSearch, User, Property
        
        logger.info("📧 Starting weekly digest sending...")
        
        last_week = datetime.utcnow() - timedelta(days=7)
        
        new_properties = Property.query.filter(
            Property.created_at >= last_week,
            Property.is_active == True,
            Property.status.in_(['Продается', 'В продаже'])
        ).all()
        
        if not new_properties:
            logger.info("No new properties for weekly digest")
            return 0
        
        weekly_searches = SavedSearch.query.filter(
            SavedSearch.alert_enabled == True,
            SavedSearch.alert_frequency == 'weekly'
        ).all()
        
        digests_sent = 0
        
        for search in weekly_searches:
            matching_props = [p for p in new_properties if AlertService._property_matches_search(p, search)]
            
            if not matching_props:
                continue
            
            user = User.query.get(search.user_id)
            if not user or not user.email_notifications:
                continue
            
            new_props = [p for p in matching_props if not AlertService._already_alerted(search.id, p.id, 'NEW_LISTING')]
            
            if new_props:
                success = AlertService._send_digest_email(
                    user=user,
                    search=search,
                    properties=new_props,
                    digest_type='weekly'
                )
                
                if success:
                    for prop in new_props:
                        AlertService._create_alert_record(
                            search=search,
                            property=prop,
                            alert_type='NEW_LISTING',
                            frequency='weekly',
                            channel='email'
                        )
                    digests_sent += 1
        
        logger.info(f"✅ Sent {digests_sent} weekly digests")
        return digests_sent
    
    @staticmethod
    def trigger_new_property_alerts(property_id):
        """Trigger alerts for a newly created property"""
        from models import Property, SavedSearch, User
        
        logger.info(f"🎯 Triggering alerts for new property {property_id}...")
        
        property = Property.query.get(property_id)
        if not property:
            logger.error(f"Property {property_id} not found")
            return False
        
        matches = AlertService.match_properties_to_searches([property])
        
        for search_id, properties in matches.items():
            search = SavedSearch.query.get(search_id)
            if not search:
                continue
            
            user = User.query.get(search.user_id)
            if not user:
                continue
            
            if search.alert_frequency == 'instant' and AlertService._can_send_instant_alert(search):
                AlertService._send_property_alert(
                    user=user,
                    search=search,
                    property=property,
                    alert_type='NEW_LISTING',
                    frequency='instant'
                )
                AlertService._increment_daily_counter(search)
        
        logger.info(f"✅ Triggered alerts for property {property_id}")
        return True
    
    @staticmethod
    def _send_property_alert(user, search, property, alert_type, frequency):
        """Send individual property alert email"""
        from email_service import send_email
        
        try:
            channels = json.loads(search.alert_channels) if search.alert_channels else ['email']
            
            if 'email' not in channels:
                return False
            
            unsubscribe_token = AlertService._generate_unsubscribe_token(search.id)
            property_url = f"{os.environ.get('BASE_URL', 'https://inback.ru')}/property/{property.id}"
            unsubscribe_url = f"{os.environ.get('BASE_URL', 'https://inback.ru')}/alerts/unsubscribe/{unsubscribe_token}"
            
            success = send_email(
                to_email=user.email,
                subject=f"🏠 Новый объект по вашему поиску: {search.name}",
                template_name="emails/property_alert_instant.html",
                user=user,
                search=search,
                property=property,
                property_url=property_url,
                unsubscribe_url=unsubscribe_url
            )
            
            if success:
                AlertService._create_alert_record(search, property, alert_type, frequency, 'email')
                logger.info(f"✅ Sent {alert_type} alert to {user.email} for property {property.id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error sending property alert: {e}")
            return False
    
    @staticmethod
    def _send_digest_email(user, search, properties, digest_type):
        """Send digest email with multiple properties"""
        from email_service import send_email
        db = get_db()
        
        try:
            channels = json.loads(search.alert_channels) if search.alert_channels else ['email']
            
            if 'email' not in channels:
                return False
            
            unsubscribe_token = AlertService._generate_unsubscribe_token(search.id)
            base_url = os.environ.get('BASE_URL', 'https://inback.ru')
            unsubscribe_url = f"{base_url}/alerts/unsubscribe/{unsubscribe_token}"
            
            template = f"emails/property_alert_{digest_type}.html"
            subject_prefix = "📅 Дневная сводка" if digest_type == 'daily' else "📆 Недельная сводка"
            
            success = send_email(
                to_email=user.email,
                subject=f"{subject_prefix}: {search.name} ({len(properties)} новых объектов)",
                template_name=template,
                user=user,
                search=search,
                properties=properties,
                properties_count=len(properties),
                base_url=base_url,
                unsubscribe_url=unsubscribe_url
            )
            
            if success:
                search.last_alert_sent = datetime.utcnow()
                db.session.commit()
                logger.info(f"✅ Sent {digest_type} digest to {user.email} with {len(properties)} properties")
            
            return success
            
        except Exception as e:
            logger.error(f"Error sending digest email: {e}")
            return False
    
    @staticmethod
    def _create_alert_record(search, property, alert_type, frequency, channel):
        """Create PropertyAlert record for tracking"""
        from models import PropertyAlert
        db = get_db()
        
        try:
            alert = PropertyAlert(
                saved_search_id=search.id,
                property_id=property.id,
                user_id=search.user_id,
                alert_type=alert_type,
                alert_frequency=frequency,
                property_price_at_send=property.price,
                delivery_channel=channel,
                delivery_status='sent',
                sent_at=datetime.utcnow()
            )
            
            db.session.add(alert)
            db.session.commit()
            
            return True
            
        except Exception as e:
            logger.error(f"Error creating alert record: {e}")
            db.session.rollback()
            return False
    
    @staticmethod
    def _can_send_instant_alert(search):
        """Check if instant alert can be sent (rate limiting)"""
        db = get_db()
        
        today = date.today()
        
        if search.alert_count_reset_date != today:
            search.alert_count_today = 0
            search.alert_count_reset_date = today
            db.session.commit()
        
        return search.alert_count_today < AlertService.INSTANT_ALERT_LIMIT
    
    @staticmethod
    def _increment_daily_counter(search):
        """Increment daily alert counter"""
        db = get_db()
        
        search.alert_count_today = (search.alert_count_today or 0) + 1
        search.last_alert_sent = datetime.utcnow()
        db.session.commit()
    
    @staticmethod
    def _already_alerted(search_id, property_id, alert_type):
        """Check if alert already sent"""
        from models import PropertyAlert
        
        exists = PropertyAlert.query.filter_by(
            saved_search_id=search_id,
            property_id=property_id,
            alert_type=alert_type
        ).first()
        
        return exists is not None
    
    @staticmethod
    def _generate_unsubscribe_token(search_id):
        """Generate JWT token for unsubscribe link"""
        secret = os.environ.get('SESSION_SECRET', 'dev-secret-key')
        payload = {
            'search_id': search_id,
            'exp': datetime.utcnow() + timedelta(days=365)
        }
        return jwt.encode(payload, secret, algorithm='HS256')
    
    @staticmethod
    def get_alert_history(user_id, limit=20, offset=0):
        """Get alert history for user with pagination"""
        from models import PropertyAlert
        
        alerts = PropertyAlert.query.filter_by(
            user_id=user_id
        ).order_by(
            desc(PropertyAlert.sent_at)
        ).limit(limit).offset(offset).all()
        
        total_count = PropertyAlert.query.filter_by(user_id=user_id).count()
        
        return {
            'alerts': [alert.to_dict() for alert in alerts],
            'total': total_count,
            'limit': limit,
            'offset': offset
        }
    
    @staticmethod
    def notify_property_sold(property_id):
        """
        Уведомить всех пользователей о продаже объекта если он у них:
        - в избранном (favorites)
        - в сравнении (comparison)
        - в презентациях (presentations)
        
        Отправить Email и Telegram уведомления
        """
        from models import Property, Favorite, ComparisonProperty, CollectionProperty, User, Manager
        from email_service import send_email, telegram_bot
        import asyncio
        
        logger.info(f"📢 Sending sold notifications for property {property_id}...")
        
        db = get_db()
        
        # Получить объект Property
        property = Property.query.get(property_id)
        if not property:
            logger.error(f"Property {property_id} not found")
            return False
        
        # Собрать всех уникальных пользователей
        user_ids = set()
        
        # 1. Найти пользователей с объектом в избранном (Favorite)
        favorites = Favorite.query.filter_by(property_id=property_id).all()
        for fav in favorites:
            user_ids.add(fav.user_id)
            logger.info(f"  Found in favorites: user {fav.user_id}")
        
        # 2. Найти пользователей с объектом в сравнении (ComparisonProperty)
        # ComparisonProperty использует строковый property_id
        property_id_str = str(property_id)
        comparison_properties = ComparisonProperty.query.filter_by(property_id=property_id_str).all()
        for cp in comparison_properties:
            # Получить user_id через user_comparison или manager_comparison
            if cp.user_comparison_id:
                from models import UserComparison
                user_comparison = UserComparison.query.get(cp.user_comparison_id)
                if user_comparison:
                    user_ids.add(user_comparison.user_id)
                    logger.info(f"  Found in user comparison: user {user_comparison.user_id}")
            if cp.manager_comparison_id:
                from models import ManagerComparison
                manager_comparison = ManagerComparison.query.get(cp.manager_comparison_id)
                if manager_comparison and manager_comparison.created_for_user_id:
                    user_ids.add(manager_comparison.created_for_user_id)
                    logger.info(f"  Found in manager comparison: user {manager_comparison.created_for_user_id}")
        
        # 3. Найти пользователей с объектом в коллекциях/презентациях (CollectionProperty)
        collection_properties = CollectionProperty.query.filter_by(property_id=property_id_str).all()
        for coll_prop in collection_properties:
            from models import Collection
            collection = Collection.query.get(coll_prop.collection_id)
            if collection and collection.assigned_to_user_id:
                user_ids.add(collection.assigned_to_user_id)
                logger.info(f"  Found in collection/presentation: user {collection.assigned_to_user_id}")
        
        logger.info(f"📊 Total unique users to notify: {len(user_ids)}")
        
        # Отправить уведомления каждому уникальному пользователю
        notifications_sent = 0
        
        for user_id in user_ids:
            user = User.query.get(user_id)
            if not user:
                continue
            
            # Подготовить данные для шаблона
            base_url = os.environ.get('BASE_URL', 'https://inback.ru')
            similar_url = f"{base_url}/properties"
            
            # Добавить параметры поиска похожих объектов
            if property.rooms is not None:
                similar_url += f"?rooms={property.rooms}"
            if property.residential_complex_id:
                similar_url += f"&complex_id={property.residential_complex_id}"
            
            # a) Отправить Email уведомление
            try:
                email_success = send_email(
                    to_email=user.email,
                    subject="🔴 Объект из вашего списка продан",
                    template_name="emails/property_sold_notification.html",
                    user=user,
                    property=property,
                    similar_url=similar_url,
                    base_url=base_url
                )
                
                if email_success:
                    logger.info(f"  ✅ Email sent to {user.email}")
                    notifications_sent += 1
                else:
                    logger.warning(f"  ⚠️ Failed to send email to {user.email}")
            except Exception as e:
                logger.error(f"  ❌ Error sending email to {user.email}: {e}")
            
            # b) Отправить Telegram уведомление если есть telegram_id
            if user.telegram_id and telegram_bot:
                try:
                    message = (
                        f"🔴 <b>Объект продан</b>\n\n"
                        f"📍 {property.title or 'Объект'}\n"
                    )
                    
                    if property.residential_complex:
                        message += f"🏢 ЖК: {property.residential_complex.name}\n"
                    
                    if property.price:
                        message += f"💰 Цена: {'{:,.0f}'.format(property.price).replace(',', ' ')} ₽\n"
                    
                    message += f"\n<a href='{similar_url}'>🔍 Смотреть похожие объекты</a>"
                    
                    # Синхронная отправка Telegram сообщения
                    asyncio.run(telegram_bot.send_message(
                        chat_id=user.telegram_id,
                        text=message,
                        parse_mode='HTML'
                    ))
                    
                    logger.info(f"  ✅ Telegram notification sent to user {user.id}")
                except Exception as e:
                    logger.error(f"  ⚠️ Failed to send Telegram notification to user {user.id}: {e}")
        
        logger.info(f"✅ Sent {notifications_sent} sold property notifications")
        return notifications_sent > 0
