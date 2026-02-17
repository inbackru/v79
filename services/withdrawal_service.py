import logging
from datetime import datetime
from decimal import Decimal
import json
from sqlalchemy import desc, or_
from sqlalchemy.exc import SQLAlchemyError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_db():
    """Lazy import to avoid circular dependency"""
    from app import db
    return db


class WithdrawalService:
    """
    Service for managing withdrawal requests
    Handles creation, approval, rejection, and payment of withdrawal requests
    """
    
    @staticmethod
    def _format_currency(amount):
        """Format Decimal amount as Russian currency string: 1 234,56 ₽"""
        from decimal import Decimal, ROUND_HALF_UP
        KOPECK = Decimal('0.01')
        rounded = Decimal(amount).quantize(KOPECK, rounding=ROUND_HALF_UP)
        # Форматировать с разделителями и 2 знаками
        formatted = f"{rounded:,.2f}".replace(',', ' ').replace('.', ',')
        return f"{formatted} ₽"
    
    @staticmethod
    def _send_withdrawal_notification(withdrawal_request, event_type):
        """Send notification about withdrawal request status change
        
        Args:
            withdrawal_request: WithdrawalRequest instance
            event_type: 'approved', 'rejected', 'paid'
        """
        try:
            from telegram_bot import send_telegram_message
            from app import send_email_notification
            from models import User
            from app import app
            
            user = User.query.get(withdrawal_request.user_id)
            if not user:
                return
            
            # Подготовить сообщения
            if event_type == 'approved':
                telegram_msg = f"✅ Ваша заявка на вывод {WithdrawalService._format_currency(withdrawal_request.amount)} одобрена!\n\nОжидайте поступления средств в течение 3-5 рабочих дней."
                email_subject = f"Заявка на вывод {WithdrawalService._format_currency(withdrawal_request.amount)} одобрена"
                email_body = f"""
Здравствуйте, {user.full_name or user.email.split('@')[0]}!

Ваша заявка на вывод средств одобрена.

Детали:
- Сумма: {WithdrawalService._format_currency(withdrawal_request.amount)}
- Способ выплаты: {withdrawal_request.payout_method}
- Дата одобрения: {withdrawal_request.processed_at.strftime('%d.%m.%Y %H:%M') if withdrawal_request.processed_at else 'N/A'}

Средства будут переведены в течение 3-5 рабочих дней.

С уважением,
Команда InBack
"""
            elif event_type == 'rejected':
                telegram_msg = f"❌ Ваша заявка на вывод {WithdrawalService._format_currency(withdrawal_request.amount)} отклонена.\n\nПричина: {withdrawal_request.rejection_reason}\n\nСредства возвращены на ваш баланс."
                email_subject = f"Заявка на вывод {WithdrawalService._format_currency(withdrawal_request.amount)} отклонена"
                email_body = f"""
Здравствуйте, {user.full_name or user.email.split('@')[0]}!

К сожалению, ваша заявка на вывод средств отклонена.

Детали:
- Сумма: {WithdrawalService._format_currency(withdrawal_request.amount)}
- Причина отклонения: {withdrawal_request.rejection_reason}

Средства возвращены на ваш баланс и доступны для повторной заявки.

С уважением,
Команда InBack
"""
            elif event_type == 'paid':
                telegram_msg = f"💰 Выплата {WithdrawalService._format_currency(withdrawal_request.amount)} успешно произведена!\n\nСредства отправлены на указанные реквизиты."
                email_subject = f"Выплата {WithdrawalService._format_currency(withdrawal_request.amount)} произведена"
                email_body = f"""
Здравствуйте, {user.full_name or user.email.split('@')[0]}!

Выплата успешно произведена.

Детали:
- Сумма: {WithdrawalService._format_currency(withdrawal_request.amount)}
- Способ выплаты: {withdrawal_request.payout_method}
- Дата выплаты: {withdrawal_request.paid_at.strftime('%d.%m.%Y %H:%M') if withdrawal_request.paid_at else 'N/A'}

Проверьте поступление средств на указанные реквизиты.

С уважением,
Команда InBack
"""
            else:
                return
            
            # Отправить Telegram
            if user.telegram_chat_id:
                send_telegram_message(user.telegram_chat_id, telegram_msg)
            
            # Отправить Email
            if user.email:
                send_email_notification(user.email, email_subject, email_body)
            
            app.logger.info(f"✅ Уведомления отправлены пользователю {user.id} о {event_type} заявки #{withdrawal_request.id}")
            
        except Exception as e:
            from app import app
            app.logger.error(f"Ошибка отправки уведомления о withdrawal {event_type}: {str(e)}")
    
    @staticmethod
    def _get_transaction_sum_by_type(user_id, transaction_type):
        """
        Calculate sum of transactions by type for a user
        
        Args:
            user_id: User ID
            transaction_type: Type of transaction (e.g., 'registration_bonus', 'cashback_earned')
            
        Returns:
            Decimal: Sum of transactions (0 if no transactions found)
        """
        from models import BalanceTransaction
        from sqlalchemy import func
        db = get_db()
        
        try:
            result = db.session.query(
                func.coalesce(func.sum(BalanceTransaction.amount), 0)
            ).filter(
                BalanceTransaction.user_id == user_id,
                BalanceTransaction.transaction_type == transaction_type,
                BalanceTransaction.status == 'completed'
            ).scalar()
            
            return Decimal(str(result or 0))
        except Exception as e:
            logger.error(f"❌ Error calculating transaction sum for user {user_id}, type {transaction_type}: {e}")
            return Decimal('0')
    
    @staticmethod
    def create_withdrawal_request(user_id, amount, payout_method, payout_details_dict):
        """
        Create a withdrawal request
        Moves amount from available_amount to pending_amount
        
        RESTRICTION: Users cannot withdraw registration bonus until they receive real cashback
        
        Args:
            user_id: User ID
            amount: Amount to withdraw (must be > 0 and <= available balance)
            payout_method: Payment method (bank_card, bank_account, yoomoney, qiwi)
            payout_details_dict: Dictionary with payout details (will be stored as JSON)
            
        Returns:
            WithdrawalRequest: Created withdrawal request
            
        Raises:
            ValueError: If validation fails
        """
        from models import WithdrawalRequest, UserBalance
        from services.balance_service import BalanceService
        db = get_db()
        
        if not user_id:
            raise ValueError("user_id is required")
        
        if not amount or amount <= 0:
            raise ValueError("amount must be greater than 0")
        
        if not payout_method:
            raise ValueError("payout_method is required")
        
        if not payout_details_dict:
            raise ValueError("payout_details is required")
        
        valid_methods = ['bank_card', 'bank_account', 'yoomoney', 'qiwi']
        if payout_method not in valid_methods:
            raise ValueError(f"Invalid payout_method. Must be one of: {', '.join(valid_methods)}")
        
        amount = Decimal(str(amount))
        
        try:
            with db.session.begin_nested():
                balance = BalanceService.get_or_create_user_balance(user_id)
                
                # Calculate registration bonus and cashback amounts
                registration_bonus_amount = WithdrawalService._get_transaction_sum_by_type(
                    user_id, 'registration_bonus'
                )
                cashback_earned_amount = WithdrawalService._get_transaction_sum_by_type(
                    user_id, 'cashback_earned'
                )
                
                logger.info(f"💰 User {user_id} withdrawal validation: "
                           f"available={balance.available_amount}₽, "
                           f"registration_bonus={registration_bonus_amount}₽, "
                           f"cashback_earned={cashback_earned_amount}₽, "
                           f"requested={amount}₽")
                
                # Check if user has available balance
                if balance.available_amount < amount:
                    raise ValueError(
                        f"Insufficient available balance: {balance.available_amount}₽, "
                        f"requested {amount}₽"
                    )
                
                # RESTRICTION: Cannot withdraw registration bonus until receiving real cashback
                if cashback_earned_amount == 0 and registration_bonus_amount > 0:
                    # Calculate maximum withdrawable amount (excluding registration bonus)
                    max_withdrawable = balance.available_amount - registration_bonus_amount
                    
                    logger.warning(f"⚠️  User {user_id} has NOT received cashback yet. "
                                 f"Registration bonus {registration_bonus_amount}₽ is locked. "
                                 f"Max withdrawable: {max_withdrawable}₽")
                    
                    if amount > max_withdrawable:
                        raise ValueError(
                            "Вывод регистрационного бонуса недоступен. "
                            "Получите первый кешбек от сделки, чтобы выводить средства."
                        )
                    
                    logger.info(f"✅ User {user_id} withdrawal amount {amount}₽ is within allowed limit "
                               f"(excluding registration bonus)")
                
                balance.available_amount -= amount
                balance.pending_amount += amount
                balance.updated_at = datetime.utcnow()
                
                payout_details_json = json.dumps(payout_details_dict, ensure_ascii=False)
                
                withdrawal_request = WithdrawalRequest(
                    user_id=user_id,
                    amount=amount,
                    payout_method=payout_method,
                    payout_details=payout_details_json,
                    status='pending'
                )
                
                db.session.add(withdrawal_request)
            
            db.session.commit()
            
            logger.info(f"✅ Created withdrawal request #{withdrawal_request.id} for user {user_id}: "
                       f"{amount}₽ via {payout_method}")
            
            return withdrawal_request
            
        except ValueError as e:
            db.session.rollback()
            logger.warning(f"⚠️  Validation error creating withdrawal request for user {user_id}: {e}")
            raise
        except SQLAlchemyError as e:
            db.session.rollback()
            logger.error(f"❌ Database error creating withdrawal request for user {user_id}: {e}")
            raise
        except Exception as e:
            db.session.rollback()
            logger.error(f"❌ Error creating withdrawal request for user {user_id}: {e}")
            raise
    
    @staticmethod
    def approve_withdrawal(request_id, admin_id):
        """
        Approve a withdrawal request
        Changes status from 'pending' to 'approved'
        Amount stays in pending_amount until marked as paid
        
        Args:
            request_id: Withdrawal request ID
            admin_id: Admin ID approving the request
            
        Returns:
            WithdrawalRequest: Updated withdrawal request
            
        Raises:
            ValueError: If validation fails or invalid status transition
        """
        from models import WithdrawalRequest
        db = get_db()
        
        if not request_id:
            raise ValueError("request_id is required")
        
        if not admin_id:
            raise ValueError("admin_id is required")
        
        try:
            with db.session.begin_nested():
                withdrawal_request = WithdrawalRequest.query.get(request_id)
                
                if not withdrawal_request:
                    raise ValueError(f"Withdrawal request {request_id} not found")
                
                if withdrawal_request.status != 'pending':
                    raise ValueError(
                        f"Cannot approve request with status '{withdrawal_request.status}'. "
                        f"Only 'pending' requests can be approved."
                    )
                
                withdrawal_request.status = 'approved'
                withdrawal_request.processed_by_id = admin_id
                withdrawal_request.processed_at = datetime.utcnow()
                withdrawal_request.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            logger.info(f"✅ Approved withdrawal request #{request_id} by admin {admin_id}")
            
            # Отправить уведомление
            WithdrawalService._send_withdrawal_notification(withdrawal_request, 'approved')
            
            return withdrawal_request
            
        except ValueError as e:
            db.session.rollback()
            logger.warning(f"⚠️  Validation error approving withdrawal request {request_id}: {e}")
            raise
        except SQLAlchemyError as e:
            db.session.rollback()
            logger.error(f"❌ Database error approving withdrawal request {request_id}: {e}")
            raise
        except Exception as e:
            db.session.rollback()
            logger.error(f"❌ Error approving withdrawal request {request_id}: {e}")
            raise
    
    @staticmethod
    def reject_withdrawal(request_id, admin_id, rejection_reason):
        """
        Reject a withdrawal request
        Changes status to 'rejected' and returns amount from pending to available
        
        Args:
            request_id: Withdrawal request ID
            admin_id: Admin ID rejecting the request
            rejection_reason: Reason for rejection
            
        Returns:
            WithdrawalRequest: Updated withdrawal request
            
        Raises:
            ValueError: If validation fails or invalid status transition
        """
        from models import WithdrawalRequest, UserBalance
        from services.balance_service import BalanceService
        db = get_db()
        
        if not request_id:
            raise ValueError("request_id is required")
        
        if not admin_id:
            raise ValueError("admin_id is required")
        
        if not rejection_reason:
            raise ValueError("rejection_reason is required")
        
        try:
            with db.session.begin_nested():
                withdrawal_request = WithdrawalRequest.query.get(request_id)
                
                if not withdrawal_request:
                    raise ValueError(f"Withdrawal request {request_id} not found")
                
                if withdrawal_request.status not in ['pending', 'approved']:
                    raise ValueError(
                        f"Cannot reject request with status '{withdrawal_request.status}'. "
                        f"Only 'pending' or 'approved' requests can be rejected."
                    )
                
                balance = BalanceService.get_or_create_user_balance(withdrawal_request.user_id)
                
                balance.pending_amount -= withdrawal_request.amount
                balance.available_amount += withdrawal_request.amount
                balance.updated_at = datetime.utcnow()
                
                withdrawal_request.status = 'rejected'
                withdrawal_request.processed_by_id = admin_id
                withdrawal_request.rejection_reason = rejection_reason
                withdrawal_request.processed_at = datetime.utcnow()
                withdrawal_request.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            logger.info(f"✅ Rejected withdrawal request #{request_id} by admin {admin_id}. "
                       f"Returned {withdrawal_request.amount}₽ to available balance.")
            
            # Отправить уведомление
            WithdrawalService._send_withdrawal_notification(withdrawal_request, 'rejected')
            
            return withdrawal_request
            
        except ValueError as e:
            db.session.rollback()
            logger.warning(f"⚠️  Validation error rejecting withdrawal request {request_id}: {e}")
            raise
        except SQLAlchemyError as e:
            db.session.rollback()
            logger.error(f"❌ Database error rejecting withdrawal request {request_id}: {e}")
            raise
        except Exception as e:
            db.session.rollback()
            logger.error(f"❌ Error rejecting withdrawal request {request_id}: {e}")
            raise
    
    @staticmethod
    def mark_as_paid(request_id, admin_id):
        """
        Mark withdrawal request as paid
        Changes status to 'paid', deducts from pending_amount, updates total_withdrawn,
        and creates debit transaction record
        
        Args:
            request_id: Withdrawal request ID
            admin_id: Admin ID marking as paid
            
        Returns:
            WithdrawalRequest: Updated withdrawal request
            
        Raises:
            ValueError: If validation fails or invalid status transition
        """
        from models import WithdrawalRequest, UserBalance, BalanceTransaction
        from services.balance_service import BalanceService
        db = get_db()
        
        if not request_id:
            raise ValueError("request_id is required")
        
        if not admin_id:
            raise ValueError("admin_id is required")
        
        try:
            with db.session.begin_nested():
                withdrawal_request = WithdrawalRequest.query.get(request_id)
                
                if not withdrawal_request:
                    raise ValueError(f"Withdrawal request {request_id} not found")
                
                if withdrawal_request.status != 'approved':
                    raise ValueError(
                        f"Cannot mark as paid request with status '{withdrawal_request.status}'. "
                        f"Only 'approved' requests can be marked as paid."
                    )
                
                balance = BalanceService.get_or_create_user_balance(withdrawal_request.user_id)
                
                if balance.pending_amount < withdrawal_request.amount:
                    raise ValueError(
                        f"Insufficient pending balance: {balance.pending_amount}₽, "
                        f"required {withdrawal_request.amount}₽"
                    )
                
                balance_before = balance.available_amount
                
                balance.pending_amount -= withdrawal_request.amount
                balance.total_withdrawn += withdrawal_request.amount
                balance.last_transaction_at = datetime.utcnow()
                balance.updated_at = datetime.utcnow()
                
                balance_after = balance.available_amount
                
                transaction = BalanceTransaction(
                    user_id=withdrawal_request.user_id,
                    amount=-withdrawal_request.amount,
                    transaction_type='withdrawal',
                    description=f"Вывод средств через {withdrawal_request.payout_method}",
                    balance_before=balance_before,
                    balance_after=balance_after,
                    withdrawal_request_id=request_id,
                    created_by_id=admin_id,
                    status='completed',
                    processed_at=datetime.utcnow()
                )
                
                db.session.add(transaction)
                
                withdrawal_request.status = 'paid'
                withdrawal_request.paid_at = datetime.utcnow()
                withdrawal_request.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            logger.info(f"✅ Marked withdrawal request #{request_id} as paid by admin {admin_id}. "
                       f"Deducted {withdrawal_request.amount}₽ from pending balance, "
                       f"updated total_withdrawn.")
            
            # Отправить уведомление
            WithdrawalService._send_withdrawal_notification(withdrawal_request, 'paid')
            
            return withdrawal_request
            
        except ValueError as e:
            db.session.rollback()
            logger.warning(f"⚠️  Validation error marking withdrawal request {request_id} as paid: {e}")
            raise
        except SQLAlchemyError as e:
            db.session.rollback()
            logger.error(f"❌ Database error marking withdrawal request {request_id} as paid: {e}")
            raise
        except Exception as e:
            db.session.rollback()
            logger.error(f"❌ Error marking withdrawal request {request_id} as paid: {e}")
            raise
    
    @staticmethod
    def get_withdrawal_request(request_id):
        """
        Get withdrawal request by ID
        
        Args:
            request_id: Withdrawal request ID
            
        Returns:
            WithdrawalRequest: Withdrawal request or None
        """
        from models import WithdrawalRequest
        
        try:
            withdrawal_request = WithdrawalRequest.query.get(request_id)
            return withdrawal_request
            
        except Exception as e:
            logger.error(f"❌ Error getting withdrawal request {request_id}: {e}")
            raise
    
    @staticmethod
    def get_withdrawal_requests(user_id=None, status=None, limit=50, offset=0):
        """
        Get withdrawal requests with filtering
        
        Args:
            user_id: Filter by user ID (optional)
            status: Filter by status (pending, approved, paid, rejected) (optional)
            limit: Maximum number of requests to return
            offset: Number of requests to skip
            
        Returns:
            list: List of WithdrawalRequest objects ordered by created_at desc
        """
        from models import WithdrawalRequest
        
        try:
            query = WithdrawalRequest.query
            
            if user_id:
                query = query.filter_by(user_id=user_id)
            
            if status:
                query = query.filter_by(status=status)
            
            requests = query.order_by(
                desc(WithdrawalRequest.created_at)
            ).limit(limit).offset(offset).all()
            
            logger.info(f"Retrieved {len(requests)} withdrawal requests "
                       f"(user_id={user_id}, status={status})")
            
            return requests
            
        except Exception as e:
            logger.error(f"❌ Error getting withdrawal requests: {e}")
            raise
    
    @staticmethod
    def get_withdrawal_request_count(user_id=None, status=None):
        """
        Get total withdrawal request count with filtering
        
        Args:
            user_id: Filter by user ID (optional)
            status: Filter by status (optional)
            
        Returns:
            int: Total number of requests
        """
        from models import WithdrawalRequest
        
        try:
            query = WithdrawalRequest.query
            
            if user_id:
                query = query.filter_by(user_id=user_id)
            
            if status:
                query = query.filter_by(status=status)
            
            count = query.count()
            return count
            
        except Exception as e:
            logger.error(f"❌ Error getting withdrawal request count: {e}")
            raise
