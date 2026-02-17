#!/bin/bash

# Скрипт восстановления только данных (без изменения схемы)
# Используйте этот скрипт, если схема базы данных уже существует

set -e

echo "=========================================="
echo "  Восстановление данных базы InBack"
echo "=========================================="
echo ""

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Ошибка: DATABASE_URL не установлен"
    echo "Убедитесь, что вы находитесь в Replit окружении"
    exit 1
fi

DUMP_FILE=$(ls -t inback_backup_*.dump 2>/dev/null | head -1)

if [ -z "$DUMP_FILE" ]; then
    echo "❌ Ошибка: Файл дампа не найден"
    echo "Ожидаемый формат: inback_backup_YYYYMMDD_HHMMSS.dump"
    exit 1
fi

echo "📁 Найден файл дампа: $DUMP_FILE"
echo "📊 Размер файла: $(du -h "$DUMP_FILE" | cut -f1)"
echo ""

echo "ℹ️  Этот скрипт восстановит только данные без изменения схемы таблиц"
echo ""
read -p "Продолжить? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Отменено пользователем"
    exit 1
fi

echo "🔄 Начинаем восстановление данных..."
echo ""

pg_restore -d "$DATABASE_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --jobs=4 \
    "$DUMP_FILE" 2>&1 | grep -v "WARNING\|ERROR: role" || true

echo ""
echo "Проверка восстановленных данных..."
psql "$DATABASE_URL" -c "
SELECT 
    'properties' as table_name, COUNT(*) as count FROM properties
UNION ALL
SELECT 'residential_complexes', COUNT(*) FROM residential_complexes
UNION ALL
SELECT 'it_companies', COUNT(*) FROM it_companies
UNION ALL
SELECT 'districts', COUNT(*) FROM districts
UNION ALL
SELECT 'streets', COUNT(*) FROM streets;
"

echo ""
echo "=========================================="
echo "✅ Данные успешно восстановлены!"
echo "=========================================="
