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

import urllib.parse

import requests

try:
    from langdetect import detect
except ImportError:
    detect = None

# ---------------------------------------------------------------------------
# sign 盐值（从 DataEye 前端 JS 逆向获得）
# ---------------------------------------------------------------------------
SIGN_SALT = "g:%w0k7&q1v9^tRnLz!M"

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


def _safe_print(text: str):
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        print(text.encode("utf-8", errors="replace").decode("utf-8", errors="replace"), flush=True)


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    _safe_print(f"[{ts}] {msg}")


def debug(msg: str):
    """调试级别日志，前缀 [DEBUG]"""
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    _safe_print(f"[{ts}] [DEBUG] {msg}")


def log_error(msg: str):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with open(ERROR_LOG, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.now().isoformat()}] {msg}\n")


# ---------------------------------------------------------------------------
# Cookie & Sign
# ---------------------------------------------------------------------------
def load_cookie() -> str:
    debug(f"正在读取配置文件: {CONFIG_PATH}")
    if not CONFIG_PATH.exists():
        log("❌ config.json 不存在，请先在设置页面配置 Cookie")
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cookie = cfg.get("cookie", "")
    if not cookie:
        log("❌ Cookie 未配置，请先在设置页面配置")
        sys.exit(1)
    debug(f"Cookie 已加载, 长度={len(cookie)}, 前30字符: {cookie[:30]}...")
    return cookie


def compute_sign(params: dict) -> str:
    """按 DataEye 前端 computeSignByParams 算法生成签名。
    1. 将参数 key 按字母排序
    2. 拼接为 key=value& 格式（sign 字段排除）
    3. 末尾追加 &key=<SIGN_SALT>
    4. MD5 后转大写
    """
    filtered = {k: v for k, v in params.items() if k != "sign"}
    parts = []
    for k in sorted(filtered.keys()):
        v = filtered[k]
        if isinstance(v, str):
            v = urllib.parse.unquote(urllib.parse.quote(v.strip(), safe=""))
        if v is None:
            v = ""
        parts.append(f"{k}={v}")
    raw = "&".join(parts) + f"&key={SIGN_SALT}"
    sign = hashlib.md5(raw.encode()).hexdigest().upper()
    debug(f"compute_sign: raw={raw[:80]}... -> {sign}")
    return sign


def build_headers(cookie: str) -> dict:
    today_str = datetime.now().strftime("%m/%d/%Y")
    s_value = hashlib.md5(today_str.encode()).hexdigest().upper()
    debug(f"构建请求头 (S={s_value[:8]}...)")
    return {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Content-Language": "zh-cn",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "S": s_value,
    }


# ---------------------------------------------------------------------------
# API 请求
# ---------------------------------------------------------------------------
def check_response(data: dict, cookie: str) -> bool:
    """检查响应状态，Cookie 失效时终止"""
    code = data.get("statusCode")
    msg = data.get("msg", "")
    debug(f"响应校验: statusCode={code}, msg={msg}")
    if code != 200 or msg != "success":
        if code == 401 or "token" in msg.lower() or "login" in msg.lower():
            log("❌ Cookie 已失效，请更新")
            sys.exit(1)
        log(f"⚠️ 响应异常: statusCode={code}, msg={msg}")
        return False
    return True


def fetch_ranking(cookie: str, product_id: int, headers: dict) -> list[dict]:
    this_times = str(int(time.time() * 1000))
    payload = {
        "pageId": 1,
        "pageSize": 20,
        "dimDate": 7,
        "productId": product_id,
        "thisTimes": this_times,
    }
    payload["sign"] = compute_sign(payload)
    debug(f"[API] 发送榜单请求 -> {URL_LIST}")
    debug(f"  参数: productId={product_id}, pageSize=20, dimDate=7")
    resp = requests.post(URL_LIST, data=payload, headers=headers, timeout=30)
    debug(f"  收到响应: HTTP {resp.status_code}, 长度={len(resp.text)}")
    data = resp.json()
    if not check_response(data, cookie):
        return []
    content = data.get("content", data.get("data", {}))
    if isinstance(content, dict):
        items = content.get("list", [])
    elif isinstance(content, list):
        items = content
    else:
        items = []
    debug(f"  解析结果: 获取到 {len(items)} 条榜单数据")
    if items:
        debug(f"  首条keys: {list(items[0].keys()) if isinstance(items[0], dict) else 'N/A'}")
    return items


def fetch_detail(cookie: str, playlet_id: str, headers: dict) -> dict | None:
    this_times = str(int(time.time() * 1000))
    payload = {
        "playletId": playlet_id,
        "thisTimes": this_times,
    }
    payload["sign"] = compute_sign(payload)
    debug(f"[API] 发送详情请求 -> {URL_DETAIL}")
    debug(f"  参数: playletId={playlet_id}")
    resp = requests.post(URL_DETAIL, data=payload, headers=headers, timeout=30)
    debug(f"  收到响应: HTTP {resp.status_code}, 长度={len(resp.text)}")
    data = resp.json()
    if not check_response(data, cookie):
        return None
    detail = data.get("content", data.get("data"))
    if isinstance(detail, list) and len(detail) > 0:
        detail = detail[0]
    if detail and isinstance(detail, dict):
        debug(f"  剧名: {detail.get('playletName', '?')}, 热力值: {detail.get('consumeNum', '?')}")
        debug(f"  详情keys: {list(detail.keys())}")
    else:
        debug(f"  详情数据为空, 响应keys: {list(data.keys())}")
    return detail if isinstance(detail, dict) else None


def fetch_trend(cookie: str, playlet_id: str, start_date: str, end_date: str, headers: dict) -> list[dict]:
    this_times = str(int(time.time() * 1000))
    payload = {
        "startDate": start_date,
        "endDate": end_date,
        "playletId": playlet_id,
        "isUnifiedPlaylet": "false",
        "thisTimes": this_times,
    }
    payload["sign"] = compute_sign(payload)
    debug(f"[API] 发送趋势请求 -> {URL_TREND}")
    debug(f"  参数: playletId={playlet_id}, {start_date} ~ {end_date}")
    resp = requests.post(URL_TREND, data=payload, headers=headers, timeout=30)
    debug(f"  收到响应: HTTP {resp.status_code}, 长度={len(resp.text)}")
    data = resp.json()
    if not check_response(data, cookie):
        return []
    trend_data = data.get("content", data.get("data", []))
    trend_list = trend_data if isinstance(trend_data, list) else []
    debug(f"  解析结果: 获取到 {len(trend_list)} 条趋势数据")
    return trend_list


# ---------------------------------------------------------------------------
# 语种识别
# ---------------------------------------------------------------------------
def detect_language(text: str) -> str:
    if not text or not detect:
        debug(f"语种识别跳过: text={'空' if not text else '有'}, langdetect={'已安装' if detect else '未安装'}")
        return "Unknown"
    try:
        code = detect(text)
        result = LANG_MAP.get(code, "Unknown")
        debug(f"语种识别: code={code} -> {result}")
        return result
    except Exception as e:
        debug(f"语种识别异常: {e}")
        return "Unknown"


# ---------------------------------------------------------------------------
# 数据库
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    debug(f"连接数据库: {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    debug("数据库连接成功")
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

    debug(f"[DB] upsert_drama: playlet_id={playlet_id}, title={title[:20]}")

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
        debug(f"  -> UPDATE 已有记录 (id={existing[0]})")
    else:
        conn.execute(
            "INSERT INTO drama (playlet_id, title, description, language, cover_url, "
            "first_air_date, is_ai_drama, tags, creative_count) VALUES (?,?,?,?,?,?,NULL,?,?)",
            (playlet_id, title, description, language, cover_url, first_air_date, tags, creative_count),
        )
        stats["new_drama"] += 1
        debug(f"  -> INSERT 新剧集")


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
    debug(f"scrape_platform() 开始执行: platform={platform_name}, date={snapshot_date}")

    # Step 1: 获取榜单 — 多个 productId 合并去重
    all_items: dict[str, dict] = {}
    for pid in product_ids:
        try:
            debug(f"Step1: 请求榜单 productId={pid}")
            items = fetch_ranking(cookie, pid, headers)
            for item in items:
                playlet_id = str(item.get("playletId", ""))
                if not playlet_id:
                    continue
                ranking = item.get("ranking", 999)
                if playlet_id not in all_items or ranking < all_items[playlet_id].get("ranking", 999):
                    all_items[playlet_id] = item
            debug(f"Step1: productId={pid} 完成, 当前去重后共 {len(all_items)} 部")
            log(f"  ⏳ 等待2秒...")
            time.sleep(2)
        except Exception as e:
            log(f"  ⚠️ {platform_name} productId={pid} 榜单请求失败: {e}")
            log_error(f"{platform_name} productId={pid} ranking: {traceback.format_exc()}")
            stats["fail"] += 1

    log(f"  📋 {platform_name} 获取到 {len(all_items)} 部剧")

    # Step 2 & 3: 逐剧获取详情和趋势
    total = len(all_items)
    for idx, (playlet_id, item) in enumerate(all_items.items(), 1):
        try:
            ranking = item.get("ranking", 0)
            consume_num = item.get("consumeNum", 0)
            material_cnt = item.get("materialCnt", 0)
            release_day = item.get("releaseDay", 0)

            debug(f"Step2: [{idx}/{total}] 处理 playletId={playlet_id}, 排名={ranking}")

            # 获取详情
            debug(f"Step2: 获取剧集详情...")
            detail = fetch_detail(cookie, playlet_id, headers)
            log(f"  ⏳ 等待2秒...")
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
                        debug(f"Step3: 获取趋势数据 {first_seen} ~ {today_str}")
                        trend_data = fetch_trend(cookie, playlet_id, first_seen, today_str, headers)
                        inserted_count = 0
                        for t in trend_data:
                            stat_date = t.get("statDate", "")
                            num = t.get("num", 0)
                            if stat_date:
                                insert_trend(conn, playlet_id, platform_name, stat_date, num)
                                inserted_count += 1
                        debug(f"  趋势数据写入 {inserted_count} 条")
                        log(f"  ⏳ 等待2秒...")
                        time.sleep(2)
                    except Exception as e:
                        debug(f"  趋势获取异常: {e}")
                        log_error(f"{platform_name} {playlet_id} trend: {e}")
                else:
                    debug("  没有 firstSeen，跳过趋势抓取")
            else:
                language = "Unknown"
                debug("  详情获取失败，尝试最小化插入 drama 表")
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
                    debug(f"  -> INSERT 最小记录: {title}")

            # 写入排名快照
            debug(f"[DB] upsert_ranking: {playlet_id} @ {platform_name}, rank={ranking}")
            upsert_ranking(
                conn, playlet_id, platform_name, ranking,
                consume_num, material_cnt, release_day, snapshot_date,
            )
            stats["success"] += 1

            log(f"  ✅ [{idx}/{total}] #{ranking} {item.get('playletName', playlet_id)[:20]} "
                f"热力={consume_num} 素材={material_cnt} 天={release_day}")

        except Exception as e:
            stats["fail"] += 1
            log(f"  ❌ [{idx}/{total}] {playlet_id} 处理失败: {e}")
            log_error(f"{platform_name} {playlet_id}: {traceback.format_exc()}")

    debug(f"{platform_name} commit 数据库")
    conn.commit()
    log(f"  🏁 {platform_name} 完成")


def run(backfill_days: int = 0):
    log("=" * 60)
    log("DramaTracker DataEye 数据抓取")
    log("=" * 60)
    debug(f"脚本启动: Python {sys.version}")
    debug(f"工作目录: {os.getcwd()}")
    debug(f"BASE_DIR: {BASE_DIR}")
    debug(f"DB_PATH: {DB_PATH}")
    debug(f"CONFIG_PATH: {CONFIG_PATH}")
    debug(f"langdetect 可用: {detect is not None}")

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

    debug(f"待抓取日期: {dates}")
    debug(f"平台数量: {len(PLATFORMS)}")

    for date_idx, date_str in enumerate(dates, 1):
        log(f"\n{'─' * 40}")
        log(f"📅 抓取日期: {date_str} ({date_idx}/{len(dates)})")
        log(f"{'─' * 40}")

        for plat_idx, platform in enumerate(PLATFORMS, 1):
            try:
                log(f"\n--- 平台 [{plat_idx}/{len(PLATFORMS)}] ---")
                scrape_platform(cookie, headers, conn, platform, date_str)
            except SystemExit:
                raise
            except Exception as e:
                log(f"❌ 平台 {platform['name']} 整体失败: {e}")
                log_error(f"platform {platform['name']}: {traceback.format_exc()}")

    debug("关闭数据库连接")
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
    debug("脚本执行结束")


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"[启动] dataeye_scraper.py 被调用, __name__={__name__}", flush=True)
    print(f"[启动] 命令行参数: {sys.argv}", flush=True)
    parser = argparse.ArgumentParser(description="DataEye 海外短剧数据抓取")
    parser.add_argument("--backfill", type=int, default=0, help="补抓过去N天数据")
    args = parser.parse_args()
    print(f"[启动] 解析参数: backfill={args.backfill}", flush=True)
    run(backfill_days=args.backfill)
