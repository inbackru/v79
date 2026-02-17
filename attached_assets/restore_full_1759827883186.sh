#!/bin/bash

# Скрипт полного восстановления базы данных InBack
# ВНИМАНИЕ: Этот скрипт удалит все существующие данные!

set -e

echo "=========================================="
echo "  Полное восстановление базы данных InBack"
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

echo "⚠️  ВНИМАНИЕ: Это действие удалит все существующие данные в базе!"
echo ""
read -p "Вы уверены, что хотите продолжить? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Отменено пользователем"
    exit 1
fi

echo "🔄 Начинаем восстановление..."
echo ""

echo "Шаг 1/3: Очистка существующих таблиц..."
pg_restore -d "$DATABASE_URL" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --jobs=4 \
    "$DUMP_FILE" 2>&1 | grep -v "WARNING\|ERROR: role" || true

echo ""
echo "Шаг 2/3: Проверка восстановленных таблиц..."
TABLE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "✅ Восстановлено таблиц: $TABLE_COUNT"

echo ""
echo "Шаг 3/3: Проверка данных в основных таблицах..."
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
" 2>/dev/null || echo "⚠️  Некоторые таблицы могут быть пустыми"

echo ""
echo "=========================================="
echo "✅ Восстановление успешно завершено!"
echo "=========================================="
echo ""
echo "Рекомендуется перезапустить приложение для применения изменений."
