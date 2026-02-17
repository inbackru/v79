#!/bin/bash

# Скрипт создания резервной копии базы данных InBack

set -e

echo "=========================================="
echo "  Создание резервной копии базы данных"
echo "=========================================="
echo ""

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Ошибка: DATABASE_URL не установлен"
    exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SQL_FILE="inback_backup_${TIMESTAMP}.sql"
DUMP_FILE="inback_backup_${TIMESTAMP}.dump"

echo "🔄 Создание SQL дампа..."
pg_dump "$DATABASE_URL" > "$SQL_FILE"
SQL_SIZE=$(du -h "$SQL_FILE" | cut -f1)
echo "✅ SQL дамп создан: $SQL_FILE ($SQL_SIZE)"

echo ""
echo "🔄 Создание Custom формат дампа..."
pg_dump -Fc "$DATABASE_URL" > "$DUMP_FILE"
DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "✅ Custom дамп создан: $DUMP_FILE ($DUMP_SIZE)"

echo ""
echo "📊 Статистика базы данных:"
psql "$DATABASE_URL" -c "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
"

echo ""
echo "🔐 Создание контрольных сумм..."
sha256sum "$SQL_FILE" "$DUMP_FILE" > "checksums_${TIMESTAMP}.txt"
echo "✅ Контрольные суммы сохранены: checksums_${TIMESTAMP}.txt"

echo ""
echo "=========================================="
echo "✅ Резервная копия успешно создана!"
echo "=========================================="
echo ""
echo "Файлы:"
echo "  - $SQL_FILE ($SQL_SIZE)"
echo "  - $DUMP_FILE ($DUMP_SIZE)"
echo "  - checksums_${TIMESTAMP}.txt"
