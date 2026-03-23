"""
DataEye 海外短剧榜单数据抓取脚本
用法:
    python scraper/dataeye_scraper.py              # 抓取当天数据
    python scraper/dataeye_scraper.py --backfill 7 # 补抓过去7天
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import requests

try:
    from langdetect import detect
except ImportError:
    detect = None

# ---------------------------------------------------------------------------
# 路径
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "data" / "config.json"
DB_PATH = BASE_DIR / "data" / "dramatracker.db"
LOG_DIR = BASE_DIR / "logs"
ERROR_LOG = LOG_DIR / "error_log.txt"

# ---------------------------------------------------------------------------
# 平台列表
# ---------------------------------------------------------------------------
PLATFORMS = [
    {"name": "ShortMax",  "productIds": [365084, 365123]},
    {"name": "MoboShort", "productIds": [485195, 485198]},
    {"name": "MoreShort", "productIds": [393179, 445748]},
    {"name": "MyMuse",    "productIds": [3333645]},
    {"name": "LoveShots", "productIds": [365099, 365365]},
    {"name": "ReelAI",    "productIds": [390514, 392263]},
    {"name": "HiShort",   "productIds": [413255, 413256]},
    {"name": "NetShort",  "productIds": [457874, 457263]},
    {"name": "Storeel",   "productIds": [465334, 465335]},
]

# ---------------------------------------------------------------------------
# API 地址
# ---------------------------------------------------------------------------
URL_LIST = "https://oversea-v2.dataeye.com/api/product/listPlayletDistribution"
URL_DETAIL = "https://oversea-v2.dataeye.com/api/playlet/getPlayletInfo"
URL_TREND = "https://oversea-v2.dataeye.com/api/playlet/listTrendByPlaylet"

# ---------------------------------------------------------------------------
# 语种映射
# ---------------------------------------------------------------------------
LANG_MAP = {
    "en": "English", "es": "Spanish", "pt": "Portuguese",
    "fr": "French", "id": "Indonesian", "de": "German",
    "zh-cn": "Chinese", "zh-tw": "Chinese", "vi": "Vietnamese",
    "ko": "Korean", "ja": "Japanese", "ar": "Arabic", "ru": "Russian",
    "th": "Thai", "tr": "Turkish", "it": "Italian", "pl": "Polish",
    "nl": "Dutch", "hi": "Hindi",
}

# ---------------------------------------------------------------------------
# 统计计数器
# ---------------------------------------------------------------------------
stats = {
    "success": 0,
    "fail": 0,
    "new_drama": 0,
    "updated": 0,
}


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def log_error(msg: str):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with open(ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] {msg}\n")


# ---------------------------------------------------------------------------
# Cookie & Sign
# ---------------------------------------------------------------------------
def load_cookie() -> str:
    if not CONFIG_PATH.exists():
        log("❌ config.json 不存在，请先在设置页面配置 Cookie")
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cookie = cfg.get("cookie", "")
    if not cookie:
        log("❌ Cookie 未配置，请先在设置页面配置")
        sys.exit(1)
    return cookie


def make_sign() -> tuple[str, str]:
    this_times = str(int(time.time() * 1000))
    sign = hashlib.md5(this_times.encode()).hexdigest().upper()
    return this_times, sign


def build_headers(cookie: str) -> dict:
    return {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Content-Language": "zh-cn",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }


# ---------------------------------------------------------------------------
# API 请求
# ---------------------------------------------------------------------------
def check_response(data: dict, cookie: str) -> bool:
    """检查响应状态，Cookie 失效时终止"""
    code = data.get("statusCode")
    msg = data.get("msg", "")
    if code != 200 or msg != "success":
        if code == 401 or "token" in msg.lower() or "login" in msg.lower():
            log("❌ Cookie 已失效，请更新")
            sys.exit(1)
        return False
    return True


def fetch_ranking(cookie: str, product_id: int, headers: dict) -> list[dict]:
    this_times, sign = make_sign()
    payload = {
        "pageId": 1,
        "pageSize": 20,
        "dimDate": 7,
        "productId": product_id,
        "thisTimes": this_times,
        "sign": sign,
    }
    resp = requests.post(URL_LIST, data=payload, headers=headers, timeout=30)
    data = resp.json()
    if not check_response(data, cookie):
        return []
    return data.get("data", {}).get("list", [])


def fetch_detail(cookie: str, playlet_id: str, headers: dict) -> dict | None:
    this_times, sign = make_sign()
    payload = {
        "playletId": playlet_id,
        "thisTimes": this_times,
        "sign": sign,
    }
    resp = requests.post(URL_DETAIL, data=payload, headers=headers, timeout=30)
    data = resp.json()
    if not check_response(data, cookie):
        return None
    return data.get("data")


def fetch_trend(cookie: str, playlet_id: str, start_date: str, end_date: str, headers: dict) -> list[dict]:
    this_times, sign = make_sign()
    payload = {
        "startDate": start_date,
        "endDate": end_date,
        "playletId": playlet_id,
        "isUnifiedPlaylet": "false",
        "thisTimes": this_times,
        "sign": sign,
    }
    resp = requests.post(URL_TREND, data=payload, headers=headers, timeout=30)
    data = resp.json()
    if not check_response(data, cookie):
        return []
    return data.get("data", [])


# ---------------------------------------------------------------------------
# 语种识别
# ---------------------------------------------------------------------------
def detect_language(text: str) -> str:
    if not text or not detect:
        return "Unknown"
    try:
        code = detect(text)
        return LANG_MAP.get(code, "Unknown")
    except Exception:
        return "Unknown"


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def upsert_drama(conn: sqlite3.Connection, info: dict, language: str):
    playlet_id = str(info.get("playletId", ""))
    title = info.get("playletName", "")
    description = info.get("playletbrief", "")
    cover_url = info.get("coverOss", "")
    first_air_date = info.get("firstSeen", "")
    creative_count = info.get("creativeCnt", 0)
    tags_raw = info.get("playletTags", [])
    tags = json.dumps(tags_raw if isinstance(tags_raw, list) else [], ensure_ascii=False)

    existing = conn.execute(
        "SELECT id FROM drama WHERE playlet_id = ?", (playlet_id,)
    ).fetchone()

    if existing:
        conn.execute(
            "UPDATE drama SET title=?, description=?, cover_url=?, first_air_date=?, "
            "language=?, tags=?, creative_count=?, updated_at=datetime('now') WHERE playlet_id=?",
            (title, description, cover_url, first_air_date, language, tags, creative_count, playlet_id),
        )
        stats["updated"] += 1
    else:
        conn.execute(
            "INSERT INTO drama (playlet_id, title, description, language, cover_url, "
            "first_air_date, is_ai_drama, tags, creative_count) VALUES (?,?,?,?,?,?,NULL,?,?)",
            (playlet_id, title, description, language, cover_url, first_air_date, tags, creative_count),
        )
        stats["new_drama"] += 1


def upsert_ranking(conn: sqlite3.Connection, playlet_id: str, platform: str,
                    rank: int, heat_value: float, material_count: int,
                    invest_days: int, snapshot_date: str):
    existing = conn.execute(
        "SELECT id FROM ranking_snapshot WHERE playlet_id=? AND platform=? AND snapshot_date=?",
        (playlet_id, platform, snapshot_date),
    ).fetchone()

    if existing:
        conn.execute(
            "UPDATE ranking_snapshot SET rank=?, heat_value=?, material_count=?, invest_days=? "
            "WHERE id=?",
            (rank, heat_value, material_count, invest_days, existing[0]),
        )
    else:
        conn.execute(
            "INSERT INTO ranking_snapshot (playlet_id, platform, rank, heat_value, "
            "material_count, invest_days, snapshot_date) VALUES (?,?,?,?,?,?,?)",
            (playlet_id, platform, rank, heat_value, material_count, invest_days, snapshot_date),
        )


def insert_trend(conn: sqlite3.Connection, playlet_id: str, platform: str,
                 date: str, daily_count: int):
    existing = conn.execute(
        "SELECT id FROM invest_trend WHERE playlet_id=? AND platform=? AND date=?",
        (playlet_id, platform, date),
    ).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO invest_trend (playlet_id, platform, date, daily_invest_count) "
            "VALUES (?,?,?,?)",
            (playlet_id, platform, date, daily_count),
        )


# ---------------------------------------------------------------------------
# 主抓取流程
# ---------------------------------------------------------------------------
def scrape_platform(cookie: str, headers: dict, conn: sqlite3.Connection,
                    platform: dict, snapshot_date: str):
    platform_name = platform["name"]
    product_ids = platform["productIds"]
    log(f"📡 正在抓取 {platform_name} (productIds: {product_ids})")

    # Step 1: 获取榜单 — 多个 productId 合并去重
    all_items: dict[str, dict] = {}
    for pid in product_ids:
        try:
            items = fetch_ranking(cookie, pid, headers)
            for item in items:
                playlet_id = str(item.get("playletId", ""))
                if not playlet_id:
                    continue
                ranking = item.get("ranking", 999)
                if playlet_id not in all_items or ranking < all_items[playlet_id].get("ranking", 999):
                    all_items[playlet_id] = item
            time.sleep(2)
        except Exception as e:
            log(f"  ⚠️ {platform_name} productId={pid} 榜单请求失败: {e}")
            log_error(f"{platform_name} productId={pid} ranking: {traceback.format_exc()}")
            stats["fail"] += 1

    log(f"  📋 {platform_name} 获取到 {len(all_items)} 部剧")

    # Step 2 & 3: 逐剧获取详情和趋势
    for playlet_id, item in all_items.items():
        try:
            ranking = item.get("ranking", 0)
            consume_num = item.get("consumeNum", 0)
            material_cnt = item.get("materialCnt", 0)
            release_day = item.get("releaseDay", 0)

            # 获取详情
            detail = fetch_detail(cookie, playlet_id, headers)
            time.sleep(2)

            if detail:
                description = detail.get("playletbrief", "")
                language = detect_language(description)
                upsert_drama(conn, detail, language)

                consume_num = detail.get("consumeNum", consume_num)
                material_cnt = detail.get("materialCnt", material_cnt)
                release_day = detail.get("releaseDay", release_day)
                first_seen = detail.get("firstSeen", "")

                # 获取趋势
                if first_seen:
                    try:
                        today_str = datetime.now().strftime("%Y-%m-%d")
                        trend_data = fetch_trend(cookie, playlet_id, first_seen, today_str, headers)
                        for t in trend_data:
                            stat_date = t.get("statDate", "")
                            num = t.get("num", 0)
                            if stat_date:
                                insert_trend(conn, playlet_id, platform_name, stat_date, num)
                        time.sleep(2)
                    except Exception as e:
                        log_error(f"{platform_name} {playlet_id} trend: {e}")
            else:
                language = "Unknown"
                # 最少保证 drama 表有记录
                existing = conn.execute(
                    "SELECT id FROM drama WHERE playlet_id = ?", (playlet_id,)
                ).fetchone()
                if not existing:
                    title = item.get("playletName", playlet_id)
                    conn.execute(
                        "INSERT INTO drama (playlet_id, title, is_ai_drama) VALUES (?,?,NULL)",
                        (playlet_id, title),
                    )
                    stats["new_drama"] += 1

            # 写入排名快照
            upsert_ranking(
                conn, playlet_id, platform_name, ranking,
                consume_num, material_cnt, release_day, snapshot_date,
            )
            stats["success"] += 1

            log(f"  ✅ #{ranking} {item.get('playletName', playlet_id)[:20]} "
                f"热力={consume_num} 素材={material_cnt} 天={release_day}")

        except Exception as e:
            stats["fail"] += 1
            log(f"  ❌ {playlet_id} 处理失败: {e}")
            log_error(f"{platform_name} {playlet_id}: {traceback.format_exc()}")

    conn.commit()


def run(backfill_days: int = 0):
    log("=" * 60)
    log("DramaTracker DataEye 数据抓取")
    log("=" * 60)

    cookie = load_cookie()
    headers = build_headers(cookie)
    conn = get_db()

    if backfill_days > 0:
        log(f"📅 历史补抓模式: 过去 {backfill_days} 天")
        dates = [
            (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(backfill_days, -1, -1)
        ]
    else:
        dates = [datetime.now().strftime("%Y-%m-%d")]

    for date_str in dates:
        log(f"\n{'─' * 40}")
        log(f"📅 抓取日期: {date_str}")
        log(f"{'─' * 40}")

        for platform in PLATFORMS:
            try:
                scrape_platform(cookie, headers, conn, platform, date_str)
            except SystemExit:
                raise
            except Exception as e:
                log(f"❌ 平台 {platform['name']} 整体失败: {e}")
                log_error(f"platform {platform['name']}: {traceback.format_exc()}")

    conn.close()

    # 汇总
    log(f"\n{'=' * 60}")
    log("📊 抓取完成 — 汇总")
    log(f"{'=' * 60}")
    log(f"  ✅ 成功: {stats['success']} 条")
    log(f"  ❌ 失败: {stats['fail']} 条")
    log(f"  🆕 新增剧集: {stats['new_drama']} 部")
    log(f"  🔄 更新剧集: {stats['updated']} 部")
    log(f"{'=' * 60}")


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DataEye 海外短剧数据抓取")
    parser.add_argument("--backfill", type=int, default=0, help="补抓过去N天数据")
    args = parser.parse_args()
    run(backfill_days=args.backfill)
