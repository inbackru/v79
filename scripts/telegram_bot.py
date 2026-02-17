#!/usr/bin/env python3
"""
InBack Telegram Bot
Сервис кэшбека за покупку новостроек
"""

import os
import logging
import requests
import re

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
    ContextTypes
)

from app import app, db
from models import User

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
if not TELEGRAM_BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN не найден в переменных окружения!")

WEBHOOK_URL = os.environ.get('WEBHOOK_URL', '')

# ID менеджера для пересылки сообщений (можно указать несколько через запятую)
MANAGER_CHAT_IDS = os.environ.get('MANAGER_TELEGRAM_IDS', '').split(',')
MANAGER_CHAT_IDS = [chat_id.strip() for chat_id in MANAGER_CHAT_IDS if chat_id.strip()]

# Словарь для хранения активных диалогов {user_chat_id: manager_mode}
active_support_chats = {}


# ============= ПУБЛИЧНЫЕ КОМАНДЫ (для всех пользователей) =============

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Приветственное сообщение при команде /start"""
    user = update.effective_user
    
    keyboard = [
        [
            InlineKeyboardButton("💰 О кэшбеке", callback_data="cashback_info"),
            InlineKeyboardButton("❓ F.A.Q.", callback_data="faq")
        ],
        [
            InlineKeyboardButton("📝 Оставить заявку", callback_data="create_application")
        ],
        [
            InlineKeyboardButton("💬 Связаться с менеджером", callback_data="contact_manager")
        ],
        [
            InlineKeyboardButton("👤 Личный кабинет", callback_data="my_profile"),
            InlineKeyboardButton("🌐 Сайт", url="https://inback.ru")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    welcome_text = (
        f"👋 Привет, {user.first_name}!\n\n"
        "Добро пожаловать в *InBack* — сервис кэшбека за покупку новостроек!\n\n"
        "🎁 *Получите до 500,000₽* при покупке квартиры\n"
        "✅ Бесплатное сопровождение сделки\n"
        "📞 Персональный менеджер\n\n"
        "Выберите действие:"
    )
    
    await update.message.reply_text(
        welcome_text,
        reply_markup=reply_markup,
        parse_mode='Markdown'
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Справка по командам"""
    help_text = (
        "📖 *Доступные команды:*\n\n"
        "/start - Главное меню\n"
        "/help - Эта справка\n"
        "/cashback - Информация о кэшбеке\n\n"
        "💬 Или просто напишите ваш вопрос — менеджер ответит!"
    )
    
    await update.message.reply_text(help_text, parse_mode='Markdown')


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик нажатий на inline кнопки"""
    query = update.callback_query
    await query.answer()
    
    handlers = {
        "cashback_info": cashback_info,
        "faq": show_faq,
        "create_application": create_application,
        "my_profile": show_my_profile,
        "back_to_menu": back_to_menu,
        "contact_manager": contact_manager,
        "end_support": end_support_chat,
    }
    
    for key, handler in handlers.items():
        if query.data == key:
            await handler(query)
            return


async def cashback_info(query):
    """Информация о кэшбеке"""
    text = (
        "💰 *Как работает кэшбек InBack?*\n\n"
        "🎁 *До 500,000₽* при покупке квартиры!\n\n"
        "📊 *Размер кэшбека:*\n"
        "• 3-5% от стоимости квартиры\n"
        "• Зависит от ЖК и застройщика\n"
        "• Выплачивается после регистрации сделки\n\n"
        "✅ *Как получить:*\n"
        "1️⃣ Оставьте заявку через бота или сайт\n"
        "2️⃣ Менеджер подберёт варианты\n"
        "3️⃣ Оформите сделку с нашим сопровождением\n"
        "4️⃣ Получите кэшбек (30-60 дней после сделки)\n\n"
        "⚖️ *Гарантии:*\n"
        "• Бесплатное сопровождение\n"
        "• Юридическая поддержка\n"
        "• Официальный договор\n\n"
        "💡 *Пример:*\n"
        "Квартира за 10,000,000₽\n"
        "Кэшбек 4% = *400,000₽* 🎉"
    )
    
    keyboard = [
        [InlineKeyboardButton("📝 Оставить заявку", callback_data="create_application")],
        [InlineKeyboardButton("💬 Связаться с менеджером", callback_data="contact_manager")],
        [InlineKeyboardButton("🔙 Назад", callback_data="back_to_menu")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')


async def show_faq(query):
    """Показать F.A.Q."""
    text = (
        "❓ *Часто задаваемые вопросы*\n\n"
        "*1. Что такое InBack?*\n"
        "InBack — сервис кэшбека за покупку новостроек. "
        "Мы возвращаем до 500,000₽ при покупке квартиры.\n\n"
        "*2. Как получить кэшбек?*\n"
        "Оставьте заявку → менеджер подберёт квартиру → "
        "оформите сделку → получите кэшбек.\n\n"
        "*3. Это бесплатно?*\n"
        "Да! Наши услуги полностью бесплатны для покупателя.\n\n"
        "*4. Когда выплачивается кэшбек?*\n"
        "В течение 30-60 дней после регистрации сделки.\n\n"
        "*5. С какими застройщиками работаете?*\n"
        "Мы сотрудничаем с проверенными застройщиками по всей России.\n\n"
        "*6. Нужна ли ипотека?*\n"
        "Кэшбек доступен как при покупке за наличные, так и в ипотеку.\n\n"
        "❓ Остались вопросы? Свяжитесь с менеджером!"
    )
    
    keyboard = [
        [InlineKeyboardButton("💬 Задать вопрос менеджеру", callback_data="contact_manager")],
        [InlineKeyboardButton("🔙 Назад", callback_data="back_to_menu")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')


async def create_application(query):
    """Форма для создания заявки"""
    text = (
        "📝 *Оставить заявку на подбор недвижимости*\n\n"
        "Отправьте сообщение в любом формате, например:\n\n"
        "💬 _\"Интересует 2к квартира до 8 млн\n"
        "Меня зовут Иван\n"
        "Телефон: +7 900 123-45-67\"_\n\n"
        "Или свяжитесь с нами напрямую:\n"
        "📞 8 (862) 266-62-16\n"
        "📧 info@inback.ru\n\n"
        "💬 Также можете просто написать вопрос — наш менеджер ответит!"
    )
    
    keyboard = [[InlineKeyboardButton("🔙 Назад", callback_data="back_to_menu")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')


async def show_my_profile(query):
    """Показать профиль пользователя"""
    chat_id = query.from_user.id
    
    with app.app_context():
        user = User.query.filter_by(telegram_id=str(chat_id)).first()
        
        if not user:
            text = (
                "👤 *Личный кабинет*\n\n"
                "Привяжите ваш аккаунт InBack для доступа к:\n"
                "• Избранным объектам\n"
                "• Истории просмотров\n"
                "• Статусу кэшбека\n"
                "• Персональным рекомендациям\n\n"
                "Для привязки используйте команду:\n"
                "`/link ваш_email@example.com`\n\n"
                "📝 Еще нет аккаунта? Зарегистрируйтесь на сайте inback.ru"
            )
            
            keyboard = [
                [InlineKeyboardButton("🌐 Регистрация", url="https://inback.ru/register")],
                [InlineKeyboardButton("🔙 Назад", callback_data="back_to_menu")]
            ]
        else:
            favorites_count = len(user.favorites) if hasattr(user, 'favorites') else 0
            applications_count = len([a for a in user.applications if a.status in ['new', 'in_progress']]) if hasattr(user, 'applications') else 0
            
            text = (
                f"👤 *Ваш профиль InBack*\n\n"
                f"*Имя:* {user.full_name}\n"
                f"*Email:* {user.email}\n"
                f"*Телефон:* {user.phone or 'Не указан'}\n\n"
                f"📊 *Статистика:*\n"
                f"• Избранных: {favorites_count}\n"
                f"• Активных заявок: {applications_count}\n\n"
                f"🔔 Уведомления: {'Включены' if user.telegram_notifications else 'Выключены'}\n\n"
                f"Управляйте профилем: /profile\n"
                f"Настройки: /notifications"
            )
            
            keyboard = [
                [
                    InlineKeyboardButton("❤️ Избранное", callback_data="user_favorites"),
                    InlineKeyboardButton("📋 Заявки", callback_data="user_applications")
                ],
                [InlineKeyboardButton("🌐 Личный кабинет", url="https://inback.ru/dashboard")],
                [InlineKeyboardButton("🔙 Назад", callback_data="back_to_menu")]
            ]
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')


async def contact_manager(query):
    """Начать диалог с менеджером"""
    chat_id = query.from_user.id
    user_name = query.from_user.first_name
    username = query.from_user.username or "без username"
    
    # Активируем режим диалога с менеджером
    active_support_chats[chat_id] = True
    
    text = (
        "💬 *Связь с менеджером активирована!*\n\n"
        "Теперь все ваши сообщения будут переданы нашему менеджеру.\n"
        "Менеджер ответит вам в ближайшее время.\n\n"
        "📝 *Просто напишите ваш вопрос* следующим сообщением.\n\n"
        "Для завершения диалога нажмите кнопку ниже."
    )
    
    keyboard = [[InlineKeyboardButton("❌ Завершить диалог", callback_data="end_support")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')
    
    # Уведомляем менеджеров о новом обращении
    if MANAGER_CHAT_IDS:
        notification = (
            f"🔔 *Новое обращение от клиента!*\n\n"
            f"👤 Имя: {user_name}\n"
            f"📱 Username: @{username}\n"
            f"🆔 Chat ID: `{chat_id}`\n\n"
            f"Ожидаю сообщение от клиента..."
        )
        
        for manager_id in MANAGER_CHAT_IDS:
            try:
                await query.get_bot().send_message(
                    chat_id=manager_id,
                    text=notification,
                    parse_mode='Markdown'
                )
            except Exception as e:
                logger.error(f"Не удалось отправить уведомление менеджеру {manager_id}: {e}")


async def end_support_chat(query):
    """Завершить диалог с менеджером"""
    chat_id = query.from_user.id
    
    # Деактивируем режим диалога
    if chat_id in active_support_chats:
        del active_support_chats[chat_id]
    
    text = (
        "✅ *Диалог завершен*\n\n"
        "Спасибо за обращение! Если у вас возникнут еще вопросы, "
        "мы всегда рады помочь.\n\n"
        "📞 Контакты:\n"
        "8 (862) 266-62-16\n"
        "info@inback.ru"
    )
    
    keyboard = [[InlineKeyboardButton("🏠 Главное меню", callback_data="back_to_menu")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')
    
    # Уведомляем менеджеров о завершении диалога
    if MANAGER_CHAT_IDS:
        notification = f"✅ Клиент {chat_id} завершил диалог."
        for manager_id in MANAGER_CHAT_IDS:
            try:
                await query.get_bot().send_message(
                    chat_id=manager_id,
                    text=notification
                )
            except Exception as e:
                logger.error(f"Ошибка отправки уведомления менеджеру: {e}")


async def back_to_menu(query):
    """Вернуться в главное меню"""
    chat_id = query.from_user.id
    if chat_id in active_support_chats:
        del active_support_chats[chat_id]
    
    keyboard = [
        [
            InlineKeyboardButton("💰 О кэшбеке", callback_data="cashback_info"),
            InlineKeyboardButton("❓ F.A.Q.", callback_data="faq")
        ],
        [
            InlineKeyboardButton("📝 Оставить заявку", callback_data="create_application")
        ],
        [
            InlineKeyboardButton("💬 Связаться с менеджером", callback_data="contact_manager")
        ],
        [
            InlineKeyboardButton("👤 Личный кабинет", callback_data="my_profile"),
            InlineKeyboardButton("🌐 Сайт", url="https://inback.ru")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    text = (
        "🏠 *InBack - Кэшбек за новостройки*\n\n"
        "🎁 До 500,000₽ при покупке квартиры\n"
        "✅ Бесплатное сопровождение сделки\n"
        "📞 Персональный менеджер\n\n"
        "Выберите действие:"
    )
    
    await query.edit_message_text(text, reply_markup=reply_markup, parse_mode='Markdown')


# ============= КОМАНДЫ ДЛЯ ВЛАДЕЛЬЦЕВ АККАУНТОВ =============

async def link_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /link для привязки аккаунта"""
    chat_id = update.effective_chat.id
    
    if not context.args:
        await update.message.reply_text(
            "❌ Укажите ваш email адрес.\n\n"
            "Пример: `/link demo@inback.ru`",
            parse_mode='Markdown'
        )
        return
    
    email = context.args[0].lower().strip()
    
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
        await update.message.reply_text(
            "❌ Неверный формат email.\n\n"
            "Пример: `/link demo@inback.ru`",
            parse_mode='Markdown'
        )
        return
    
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        
        if not user:
            await update.message.reply_text(
                f"❌ Аккаунт с email {email} не найден.\n\n"
                "Зарегистрируйтесь на https://inback.ru/register"
            )
            return
        
        if user.telegram_id and user.telegram_id != str(chat_id):
            await update.message.reply_text(
                "❌ Этот аккаунт уже привязан к другому Telegram.\n\n"
                "Обратитесь в поддержку для смены привязки."
            )
            return
        
        user.telegram_id = str(chat_id)
        user.telegram_notifications = True
        db.session.commit()
        
        await update.message.reply_text(
            f"✅ *Аккаунт успешно привязан!*\n\n"
            f"👤 {user.full_name}\n"
            f"📧 {email}\n"
            f"🔔 Уведомления включены\n\n"
            f"Теперь вы будете получать уведомления о новых объектах и кэшбеке!\n\n"
            f"Управление: /notifications",
            parse_mode='Markdown'
        )


async def handle_text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик текстовых сообщений"""
    chat_id = update.effective_chat.id
    text = update.message.text
    user_name = update.effective_user.first_name
    username = update.effective_user.username or "без username"
    
    if chat_id in active_support_chats:
        if MANAGER_CHAT_IDS:
            manager_message = (
                f"💬 *Сообщение от клиента*\n\n"
                f"👤 {user_name} (@{username})\n"
                f"🆔 Chat ID: `{chat_id}`\n\n"
                f"📝 *Сообщение:*\n{text}\n\n"
                f"_Чтобы ответить:_\n"
                f"`/reply {chat_id} ваш_ответ`"
            )
            
            for manager_id in MANAGER_CHAT_IDS:
                try:
                    await context.bot.send_message(
                        chat_id=manager_id,
                        text=manager_message,
                        parse_mode='Markdown'
                    )
                except Exception as e:
                    logger.error(f"Ошибка отправки менеджеру {manager_id}: {e}")
            
            await update.message.reply_text(
                "✅ Ваше сообщение отправлено менеджеру.\n"
                "Ожидайте ответа..."
            )
        else:
            await update.message.reply_text(
                "⚠️ Менеджеры временно недоступны.\n"
                "Пожалуйста, позвоните: 8 (862) 266-62-16"
            )
        return
    
    text_lower = text.lower()
    
    if any(word in text_lower for word in ['кэшбек', 'cashback', 'возврат', 'кешбек']):
        await update.message.reply_text(
            "💰 *Кэшбек до 500,000₽!*\n\n"
            "От 3% до 5% от стоимости квартиры.\n\n"
            "Подробнее: /start → О кэшбеке",
            parse_mode='Markdown'
        )
    
    elif any(word in text_lower for word in ['контакт', 'телефон', 'связаться', 'позвон']):
        await update.message.reply_text(
            "📞 *Контакты:*\n\n"
            "☎️ 8 (862) 266-62-16\n"
            "📧 info@inback.ru\n"
            "🌐 inback.ru",
            parse_mode='Markdown'
        )
    
    elif any(word in text_lower for word in ['привет', 'здравствуй', 'hi', 'hello', 'добр']):
        await update.message.reply_text(
            f"Привет, {user_name}! 👋\n\n"
            "Я бот InBack — сервис кэшбека за покупку новостроек.\n\n"
            "Нажмите /start для главного меню"
        )
    
    else:
        await update.message.reply_text(
            f"💬 *Спасибо за сообщение, {user_name}!*\n\n"
            "Чтобы связаться с менеджером, нажмите /start и выберите "
            "\"Связаться с менеджером\".\n\n"
            "Или позвоните: 8 (862) 266-62-16",
            parse_mode='Markdown'
        )
        
        logger.info(f"Message from @{username}: {text}")


# ============= УТИЛИТЫ ДЛЯ ОТПРАВКИ УВЕДОМЛЕНИЙ =============

def send_telegram_message(chat_id, message):
    """Отправка сообщения через HTTP API"""
    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not configured")
        return False
    
    try:
        # Log what we're sending
        logger.info(f"📤 Sending to chat_id: {chat_id} (type: {type(chat_id)})")
        logger.info(f"📝 Message preview: {message[:200]}...")
        
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'Markdown'
        }
        
        response = requests.post(url, data=data, timeout=10)
        
        if response.status_code == 200:
            logger.info(f"✅ Message sent to {chat_id}")
            return True
        else:
            logger.error(f"❌ Telegram API error: {response.status_code}")
            logger.error(f"❌ Response: {response.text}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error sending message: {e}")
        return False


def send_recommendation_notification(user_telegram_id, recommendation_data):
    """Отправка уведомления о рекомендации"""
    if not user_telegram_id:
        return False
    
    message = f"""🏠 <b>Новая рекомендация от менеджера</b>

📋 <b>{recommendation_data.get('title', 'Новая рекомендация')}</b>
🏢 {recommendation_data.get('item_name', 'Объект')}
📝 {recommendation_data.get('description', '')}

💡 <i>Приоритет:</i> {recommendation_data.get('priority_level', 'Обычный').title()}

🔗 <a href="https://inback.ru/{recommendation_data.get('recommendation_type', 'property')}/{recommendation_data.get('item_id')}">Посмотреть объект</a>"""
    
    return send_telegram_message(user_telegram_id, message)


# ============= КОМАНДЫ ДЛЯ МЕНЕДЖЕРОВ =============

async def reply_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Команда /reply для ответа менеджера клиенту"""
    manager_id = str(update.effective_chat.id)
    
    # Проверяем, что это менеджер
    if manager_id not in MANAGER_CHAT_IDS:
        await update.message.reply_text("⛔ Эта команда доступна только менеджерам.")
        return
    
    if not context.args or len(context.args) < 2:
        await update.message.reply_text(
            "❌ Неверный формат команды.\n\n"
            "Используйте: `/reply CHAT_ID текст_ответа`\n\n"
            "Пример: `/reply 123456789 Здравствуйте! Сейчас подберу варианты.`",
            parse_mode='Markdown'
        )
        return
    
    try:
        client_chat_id = int(context.args[0])
        reply_text = ' '.join(context.args[1:])
        
        # Отправляем ответ клиенту
        await context.bot.send_message(
            chat_id=client_chat_id,
            text=f"💬 *Ответ от менеджера:*\n\n{reply_text}",
            parse_mode='Markdown'
        )
        
        # Подтверждаем менеджеру
        await update.message.reply_text(
            f"✅ Ответ отправлен клиенту {client_chat_id}"
        )
        
        logger.info(f"Manager {manager_id} replied to client {client_chat_id}")
        
    except ValueError:
        await update.message.reply_text("❌ Неверный Chat ID. Используйте числовой ID.")
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка отправки: {str(e)}")
        logger.error(f"Error in reply_command: {e}")


# ============= ЗАПУСК БОТА =============

def main():
    """Запуск бота в режиме polling"""
    if not TELEGRAM_BOT_TOKEN:
        logger.error("❌ TELEGRAM_BOT_TOKEN not set!")
        return
    
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Публичные команды
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("link", link_command))
    
    # Команды для менеджеров
    application.add_handler(CommandHandler("reply", reply_command))
    
    # Обработчик кнопок
    application.add_handler(CallbackQueryHandler(button_handler))
    
    # Обработчик текстовых сообщений
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_message))
    
    logger.info("🤖 InBack Telegram Bot запущен!")
    logger.info("📍 Россия - недвижимость с кэшбеком")
    logger.info("💰 Кэшбек до 500,000₽")
    
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()
