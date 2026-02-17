# Дамп базы данных InBack - 15.11.2025

## Информация о дампе

- **Дата создания**: 15 ноября 2025
- **База данных**: PostgreSQL (версия 16.9)
- **Проект**: InBack - платформа кешбека для недвижимости

## Файлы

1. `inback_database_dump_15.11.2025.sql` - Полный SQL дамп базы данных (несжатый)
2. `inback_database_dump_15.11.2025.sql.gz` - Сжатая версия дампа (gzip)

## Восстановление базы данных

### Из несжатого файла:
```bash
psql "$DATABASE_URL" < inback_database_dump_15.11.2025.sql
```

### Из сжатого файла:
```bash
gunzip -c inback_database_dump_15.11.2025.sql.gz | psql "$DATABASE_URL"
```

## Содержимое базы данных

База содержит следующие основные таблицы:
- Пользователи (users)
- Менеджеры (managers)
- Администраторы (admins)
- Объекты недвижимости (properties)
- Жилые комплексы (residential_complexes)
- Застройщики (developers)
- Заявки на кешбек (cashback_applications)
- Избранное (user_favorites, user_complex_favorites)
- Сравнения (user_comparisons, comparison_properties, comparison_complexes)
- Сохраненные поиски (user_saved_searches)
- Баланс пользователей (user_balances, balance_transactions)
- Заявки на вывод средств (withdrawal_requests)
- Города (cities)
- Маркетинговые материалы (marketing_materials)
- И другие вспомогательные таблицы

## Примечания

- Дамп создан с помощью `pg_dump`
- Включает полную схему и данные
- Совместим с PostgreSQL 16.x
