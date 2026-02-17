import os
import time
import hashlib
import requests
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class RedSMSService:
    """Сервис для отправки SMS через RED SMS API (cp.redsms.ru)"""
    
    API_URL = "https://cp.redsms.ru/api/message"
    
    def __init__(self):
        self.login = os.environ.get('RED_SMS_LOGIN') or os.environ.get('REDSMS_LOGIN')
        self.api_key = os.environ.get('RED_SMS_API_KEY') or os.environ.get('REDSMS_API_KEY')
        
        if not self.login or not self.api_key:
            logger.warning("RED SMS credentials not fully configured")
            if not self.login:
                logger.warning("RED_SMS_LOGIN/REDSMS_LOGIN not found in environment variables")
            if not self.api_key:
                logger.warning("RED_SMS_API_KEY/REDSMS_API_KEY not found in environment variables")
    
    def _generate_auth_headers(self) -> Dict[str, str]:
        """
        Генерация headers для авторизации RED SMS
        
        Returns:
            dict: Headers с login, ts, secret
        """
        if not self.login or not self.api_key:
            raise ValueError("RED SMS credentials not configured")
        
        # Создаем timestamp строку
        ts = f'ts-value-{int(time.time())}'
        
        # Генерируем MD5 хэш: secret = MD5(ts + api_key)
        secret_string = ts + self.api_key
        secret = hashlib.md5(secret_string.encode('utf-8')).hexdigest()
        
        logger.debug(f"🔐 Auth Headers Generation:")
        logger.debug(f"  - login: {self.login[:3]}***")
        logger.debug(f"  - ts: {ts}")
        logger.debug(f"  - secret_string: {secret_string[:10]}...{secret_string[-10:]}")
        logger.debug(f"  - secret (MD5): {secret}")
        
        return {
            'login': self.login,
            'ts': ts,
            'secret': secret,
            'Content-Type': 'application/json'
        }
    
    def send_sms(self, phone: str, message: str) -> Dict[str, Any]:
        """
        Отправить произвольное SMS сообщение через RED SMS API
        
        Args:
            phone: Номер телефона (формат: 79XXXXXXXXX)
            message: Текст сообщения
            
        Returns:
            dict: Результат отправки {'success': bool, 'message': str}
        """
        # TEST MODE: Skip actual SMS if TEST_SMS_MODE=true
        test_mode = os.environ.get('TEST_SMS_MODE', '').lower() == 'true'
        if test_mode:
            logger.info(f"🧪 TEST MODE: SMS skipped (would send to {phone}). Message: {message[:50]}...")
            return {'success': True, 'message': 'TEST MODE: SMS не отправляется'}
        
        if not self.login or not self.api_key:
            logger.error("Cannot send SMS: RED SMS credentials not configured")
            return {
                'success': False,
                'message': 'SMS сервис не настроен. Проверьте RED_SMS_LOGIN и RED_SMS_API_KEY.'
            }
        
        # Форматировать номер телефона
        phone_clean = ''.join(filter(str.isdigit, phone))
        
        # RED SMS ожидает номер в формате +79XXXXXXXXX
        if phone_clean.startswith('8'):
            phone_clean = '7' + phone_clean[1:]
        elif phone_clean.startswith('9'):
            phone_clean = '7' + phone_clean
        elif not phone_clean.startswith('7'):
            logger.error(f"Invalid phone format: {phone}")
            return {
                'success': False,
                'message': 'Неверный формат номера телефона'
            }
        
        # Добавляем + в начало
        phone_formatted = f'+{phone_clean}'
        
        # Тело запроса
        payload = {
            'route': 'sms',
            'from': 'InBack',  # Имя отправителя (требует регистрации в RED SMS)
            'to': phone_formatted,
            'text': message
        }
        
        try:
            logger.info(f"Sending SMS to {phone_clean[:2]}****{phone_clean[-4:]}")
            logger.debug(f"RED SMS API request to {self.API_URL}")
            logger.debug(f"Message: {message[:50]}...")  # Log first 50 chars
            
            # Генерируем headers для авторизации
            headers = self._generate_auth_headers()
            
            # Отправляем POST запрос
            logger.info(f"📤 Sending POST to RED SMS API...")
            response = requests.post(
                self.API_URL,
                headers=headers,
                json=payload,
                timeout=10
            )
            
            logger.info(f"📥 RED SMS response status: {response.status_code}")
            logger.debug(f"RED SMS response headers: {dict(response.headers)}")
            logger.debug(f"RED SMS response body: {response.text}")
            
            # RED SMS возвращает JSON: {"items": [...], "errors": [], "success": true}
            if response.status_code == 200:
                data = response.json()
                
                if data.get('success') and len(data.get('items', [])) > 0:
                    message_uuid = data['items'][0].get('uuid')
                    logger.info(f"✅ SMS sent successfully. UUID: {message_uuid}")
                    return {
                        'success': True,
                        'message': 'SMS отправлено',
                        'uuid': message_uuid
                    }
                elif data.get('errors'):
                    # Есть ошибки
                    errors = data.get('errors', [])
                    error_message = errors[0] if errors else 'Неизвестная ошибка'
                    logger.error(f"❌ RED SMS API error: {error_message}")
                    return {
                        'success': False,
                        'message': f'Ошибка отправки SMS: {error_message}'
                    }
                else:
                    logger.error(f"❌ RED SMS API unexpected response: {data}")
                    return {
                        'success': False,
                        'message': 'Неожиданный ответ от SMS-сервиса'
                    }
            elif response.status_code == 401:
                logger.error("❌ RED SMS API authentication failed (401)")
                return {
                    'success': False,
                    'message': 'Ошибка авторизации SMS-сервиса. Проверьте логин и API ключ.'
                }
            else:
                logger.error(f"❌ RED SMS API HTTP error: {response.status_code}")
                logger.error(f"Response: {response.text}")
                return {
                    'success': False,
                    'message': f'Ошибка HTTP {response.status_code} от SMS-сервиса'
                }
                
        except requests.exceptions.Timeout:
            logger.error("❌ RED SMS API timeout")
            return {
                'success': False,
                'message': 'Превышено время ожидания ответа от SMS-сервиса'
            }
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ RED SMS API request error: {e}")
            return {
                'success': False,
                'message': f'Ошибка соединения с SMS-сервисом: {str(e)}'
            }
        except Exception as e:
            logger.error(f"❌ Unexpected error sending SMS: {e}")
            return {
                'success': False,
                'message': f'Неожиданная ошибка: {str(e)}'
            }

    def send_verification_code(self, phone: str, code: str) -> Dict[str, Any]:
        """
        Отправить SMS с кодом верификации через RED SMS API
        
        Args:
            phone: Номер телефона (формат: 79XXXXXXXXX)
            code: 6-значный код верификации
            
        Returns:
            dict: Результат отправки {'success': bool, 'message': str}
        """
        # Форматируем сообщение и используем универсальный метод send_sms
        message_text = f"Ваш код подтверждения InBack: {code}. Код действителен 2 минуты."
        return self.send_sms(phone, message_text)
    
    def send_login_code(self, phone: str, code: str) -> Dict[str, Any]:
        """
        Отправить SMS с кодом для входа
        
        Args:
            phone: Номер телефона
            code: 6-значный код
            
        Returns:
            dict: Результат отправки
        """
        return self.send_verification_code(phone, code)


# Singleton instance
sms_service = RedSMSService()
