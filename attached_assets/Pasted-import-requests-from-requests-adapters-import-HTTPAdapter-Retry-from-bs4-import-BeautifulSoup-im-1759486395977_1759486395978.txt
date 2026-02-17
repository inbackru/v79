import requests
from requests.adapters import HTTPAdapter, Retry
from bs4 import BeautifulSoup
import pandas as pd
import re
import time
import random
import logging
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import cycle
from datetime import datetime
from pathlib import Path

# ---------- Настройка логирования ----------
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ---------- Конфигурация ----------
BASE_DOMAIN = "https://krasnodar.domclick.ru"
OUTPUT_FILE = "domclick_full_checkpoint.xlsx"
CHECKPOINT_EVERY = 100   # сохранять каждые N карточек
MAX_WORKERS = 4         # многопоточность (уменьши при проблемах с блокировкой)
REQUEST_TIMEOUT = 15
MIN_DELAY = 1.0         # минимальная задержка между запросами
MAX_DELAY = 3.5         # максимальная задержка между запросами

# Ротация User-Agent
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    # ... добавь свои агенты при необходимости
]

# Опциональные прокси. Формат: "http://user:pass@host:port" или "http://host:port"
PROXIES = [
    # "http://127.0.0.1:8080",
    # "http://user:pass@proxyhost:port",
]
USE_PROXIES = len(PROXIES) > 0
proxy_cycle = cycle(PROXIES) if USE_PROXIES else None

# Retry конфигурация для requests
RETRY_STRATEGY = Retry(
    total=3,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["HEAD", "GET", "OPTIONS"]),
    backoff_factor=1
)

# ---------- Утилиты ----------
def make_session(user_agent=None, proxy=None):
    s = requests.Session()
    headers = {
        "User-Agent": user_agent or random.choice(USER_AGENTS),
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Referer": BASE_DOMAIN
    }
    s.headers.update(headers)
    adapter = HTTPAdapter(max_retries=RETRY_STRATEGY)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    if proxy:
        s.proxies.update({
            "http": proxy,
            "https": proxy
        })
    return s

def random_delay():
    delay = random.uniform(MIN_DELAY, MAX_DELAY)
    # jitter
    time.sleep(delay + random.uniform(0, 0.5))

def is_captcha_or_blocked(resp_text, status_code):
    # Простая детекция: можно расширять в зависимости от конкретного содержимого
    if status_code in (403, 429):
        return True
    lowered = resp_text.lower()
    patterns = [
        "captcha", "recaptcha", "verify you're human", "введите символы", "подозрительная активность",
        "access denied", "blocked", "вы робот"
    ]
    for p in patterns:
        if p in lowered:
            return True
    return False

def safe_get(session, url):
    try:
        r = session.get(url, timeout=REQUEST_TIMEOUT)
        return r
    except requests.RequestException as e:
        logger.debug(f"RequestException for {url}: {e}")
        return None

# ---------- Парсер карточки (усовершенствованный) ----------
def parse_domclick_card(url, session=None, max_attempts=3):
    """
    Возвращает dict с данными карточки. session — requests.Session
    """
    if session is None:
        session = make_session()

    result = {
        'url': url,
        'innerid': '', 'addressid': '', 'complexid': '', 'developerid': '',
        'addressguid': '', 'photos': '', 'addressname': '', 'addressdisplayname': '',
        'complexname': '', 'complexphone': '', 'complexobjectclassdisplayname': '',
        'complexbuildingname': '', 'complexbuildingreleased': '', 'complexbuildingaccreditation': '',
        'complexminrate': '', 'complexsalesphone': '', 'complexsalesaddress': '',
        'complexendbuildyear': '', 'complexendbuildquarter': '', 'price': '', 'price_per_m2': '',
        'objectrooms': '', 'objectarea': '', 'objectlivingarea': '', 'objectfloor': '',
        'objectfloors': '', 'objectrenovationtype': '', 'description': '', 'buildyear': '',
        'mortgage_details': '', 'discounts': '', 'contacts': '', 'lat': '', 'lon': '',
        'scraped_at': datetime.utcnow().isoformat()
    }

    # innerid: попробуем извлечь по разным вариантам
    m = re.search(r'__([0-9a-fA-F\-]+)', url)
    if m:
        result['innerid'] = m.group(1)
    else:
        # fallback: последний сегмент
        result['innerid'] = url.rstrip('/').split('/')[-1]

    attempt = 0
    while attempt < max_attempts:
        attempt += 1
        try:
            resp = safe_get(session, url)
            if resp is None:
                logger.debug(f"No response for {url} on attempt {attempt}")
                random_delay()
                continue

            if is_captcha_or_blocked(resp.text, resp.status_code):
                logger.warning(f"Possible block/captcha for {url} (status {resp.status_code}); attempt {attempt}")
                # если есть прокси - переключаем; иначе делаем задержку с экспоненциальным ростом
                if USE_PROXIES:
                    try:
                        proxy = next(proxy_cycle)
                        session = make_session(user_agent=random.choice(USER_AGENTS), proxy=proxy)
                        logger.info(f"Switched proxy to {proxy}")
                    except StopIteration:
                        pass
                time.sleep(2 ** attempt + random.random())
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')

            # Секция: основные элементы (с учетом возможных изменений классов)
            # Тщательно ищем элементы, с fallback'ом
            find_text = lambda sel, cls: (soup.find(sel, class_=cls).get_text(strip=True) if soup.find(sel, class_=cls) else '')

            result['addressdisplayname'] = find_text('div', 'card-address') or find_text('h1', 'address-title')
            result['complexname'] = find_text('div', 'card-complex-name')
            result['complexobjectclassdisplayname'] = find_text('div', 'card-object-class')
            result['objectarea'] = find_text('span', 'card-area')
            result['objectlivingarea'] = find_text('span', 'card-living-area')
            result['objectrooms'] = find_text('span', 'card-rooms')
            result['objectfloor'] = find_text('span', 'card-floor')
            result['objectfloors'] = find_text('span', 'card-floors')
            result['objectrenovationtype'] = find_text('div', 'card-renovation')
            result['price'] = find_text('div', 'card-main-price') or find_text('span', 'price-main')
            result['price_per_m2'] = find_text('div', 'card-square-price') or find_text('span', 'price-per-m2')
            result['photos'] = ';'.join([img.get('src') or img.get('data-src') for img in soup.select('.card-gallery__slide img') if (img.get('src') or img.get('data-src'))])
            result['description'] = soup.find('div', class_='card-description').get_text(" ", strip=True) if soup.find('div', class_='card-description') else ''
            result['mortgage_details'] = soup.find('div', class_='card-mortgage-details').get_text(" ", strip=True) if soup.find('div', class_='card-mortgage-details') else ''
            result['discounts'] = ';'.join([d.get_text(strip=True) for d in soup.select('.card-discount')])
            result['contacts'] = ';'.join([tel.get_text(strip=True) for tel in soup.select('.card-contacts .phones')])

            # Координаты из скриптов: ищем несколько форматов
            lat, lon = '', ''
            for script in soup.find_all('script'):
                txt = script.string
                if not txt:
                    continue
                # JSON-like lat/lon
                m = re.search(r'"lat"\s*:\s*([0-9\.\-]+)\s*,\s*"lon"\s*:\s*([0-9\.\-]+)', txt)
                if m:
                    lat, lon = m.group(1), m.group(2)
                    break
                # другие варианты
                m2 = re.search(r'lat[:=]\s*([0-9\.\-]+).*?lon[:=]\s*([0-9\.\-]+)', txt, flags=re.S)
                if m2:
                    lat, lon = m2.group(1), m2.group(2)
                    break
            result['lat'] = lat
            result['lon'] = lon

            # Характеристики .card-spec_field
            for field in soup.select('.card-spec_field'):
                try:
                    key = field.find('span', class_='spec_title').get_text(strip=True)
                    value = field.find('span', class_='spec_value').get_text(strip=True)
                    # нормализуем ключи: латиница/пробелы -> underscore
                    key_norm = re.sub(r'\s+', '_', key.strip().lower())
                    result[key_norm] = value
                except Exception:
                    continue

            # Остальные секции/блоки
            for block in soup.select('.card-section'):
                header = block.find(['h2', 'h3'])
                if header:
                    key = re.sub(r'\s+', '_', header.get_text(strip=True).lower())
                    result[key] = block.get_text(" ", strip=True)

            # Если дошли сюда — считаем карточку успешно распаршенной
            return result

        except Exception as e:
            logger.exception(f"Error parsing {url} on attempt {attempt}: {e}")
            time.sleep(1 + random.random())
            continue

    # если не удалось
    result['error'] = f"Failed after {max_attempts} attempts"
    return result

# ---------- Получение ссылок с поиска ----------
def get_card_links(search_url, session=None):
    if session is None:
        session = make_session()
    try:
        resp = safe_get(session, search_url)
        if resp is None:
            return []
        if is_captcha_or_blocked(resp.text, resp.status_code):
            logger.warning(f"Blocked when fetching search page: {search_url} (status {resp.status_code})")
            return []
        soup = BeautifulSoup(resp.text, 'html.parser')
        links = []
        for a in soup.select('a[href*="card/"]'):
            href = a.get('href')
            if not href:
                continue
            if not href.startswith("http"):
                href = urljoin(BASE_DOMAIN, href)
            if href not in links:
                links.append(href)
        return links
    except Exception as e:
        logger.exception(f"Error getting links from {search_url}: {e}")
        return []

# ---------- Основной раннер ----------
def run_scraper(offsets=None, max_workers=MAX_WORKERS, output_file=OUTPUT_FILE):
    """
    offsets: iterable значений offset (например range(0, 40, 20))
    """
    seen_ids = set()
    all_data = []
    output_path = Path(output_file)

    # Если есть чекпоинт — загрузим уже сохранённое (дедупликация)
    if output_path.exists():
        try:
            df_prev = pd.read_excel(output_path)
            for iid in df_prev.get('innerid', []):
                seen_ids.add(str(iid))
            all_data = df_prev.to_dict(orient='records')
            logger.info(f"Loaded checkpoint with {len(all_data)} records; {len(seen_ids)} unique inner ids.")
        except Exception as e:
            logger.warning(f"Failed to load checkpoint {output_file}: {e}")

    session_for_links = make_session(user_agent=random.choice(USER_AGENTS),
                                     proxy=(next(proxy_cycle) if USE_PROXIES else None))

    offsets = offsets or [0]
    card_urls = []
    for offset in offsets:
        search_url = f"{BASE_DOMAIN}/search?deal_type=sale&category=living&offer_type=layout&from=topline2020&offset={offset}"
        logger.info(f"Fetching search page: {search_url}")
        # короткая случайная пауза перед страницей поиска
        random_delay()
        links = get_card_links(search_url, session=session_for_links)
        logger.info(f"Found {len(links)} cards on offset {offset}")
        card_urls.extend(links)

    # Удаляем дубликаты в списке URL
    card_urls = list(dict.fromkeys(card_urls))
    logger.info(f"Total unique card urls to process: {len(card_urls)}")

    # Многопоточная обработка карточек (параллельно MAX_WORKERS)
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        future_to_url = {}
        for url in card_urls:
            # если уже есть в seen_ids — пропускаем
            # innerid извлечём по URL самостоятельно, чтобы избежать лишней загрузки
            mid = re.search(r'__([0-9a-fA-F\-]+)', url)
            innerid = mid.group(1) if mid else url.rstrip('/').split('/')[-1]
            if innerid in seen_ids:
                logger.debug(f"Skipping already seen {innerid}")
                continue

            # подготовим отдельную сессию с рандомным UA / прокси
            proxy = (next(proxy_cycle) if USE_PROXIES else None)
            sess = make_session(user_agent=random.choice(USER_AGENTS), proxy=proxy)
            future = ex.submit(parse_domclick_card, url, sess)
            future_to_url[future] = (url, innerid)

        processed = 0
        for fut in as_completed(future_to_url):
            url, innerid = future_to_url[fut]
            try:
                data = fut.result()
            except Exception as e:
                logger.exception(f"Unhandled exception for {url}: {e}")
                continue

            if data.get('error'):
                logger.warning(f"Card {url} produced error: {data['error']}")

            # дедупликация
            if data.get('innerid') and str(data['innerid']) in seen_ids:
                logger.debug(f"Duplicate innerid {data['innerid']} — skipping append")
            else:
                all_data.append(data)
                if data.get('innerid'):
                    seen_ids.add(str(data['innerid']))

            processed += 1

            # Периодическое сохранение
            if processed % CHECKPOINT_EVERY == 0:
                try:
                    df = pd.DataFrame(all_data)
                    df.to_excel(output_file, index=False)
                    logger.info(f"Checkpoint saved: {len(all_data)} records")
                except Exception as e:
                    logger.exception(f"Error saving checkpoint: {e}")

            # маленькая случайная пауза между карточками
            random_delay()

    # Финальное сохранение
    try:
        df_final = pd.DataFrame(all_data)
        df_final.to_excel(output_file, index=False)
        logger.info(f"Finished. Total records saved: {len(all_data)} to {output_file}")
    except Exception as e:
        logger.exception(f"Error saving final file: {e}")

# ---------- Пример запуска ----------
if __name__ == "__main__":
    # Пример offset'ов: первые 2 страницы (по 20 карточек на страницу)
    offsets = list(range(0, 40, 20))
    run_scraper(offsets=offsets, max_workers=3)
