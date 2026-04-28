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

# B3-c 双写：本地 SQLite + 线上 sync API（失败入队，下次启动重试）
try:
    from . import sync_buffer  # type: ignore
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import sync_buffer  # type: ignore

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
# 兜底硬编码（仅当 platforms 表读取失败时使用，正常情况下走数据库）
FALLBACK_PLATFORMS = [
    {"name": "ShortMax",  "productIds": [365084, 365123]},
    {"name": "MoboShort", "productIds": [485195, 485198]},
    {"name": "MoreShort", "productIds": [393179, 445748]},
    {"name": "MyMuse",    "productIds": [2974116]},
    {"name": "LoveShots", "productIds": [365099, 365365]},
    {"name": "ReelAI",    "productIds": [390514, 392263]},
    {"name": "HiShort",   "productIds": [413255, 413256]},
    {"name": "NetShort",  "productIds": [457874, 457263]},
    {"name": "Storeel",   "productIds": [465334, 465335]},
    {"name": "iDrama",    "productIds": [2955897, 2953006]},
    {"name": "StardustTV","productIds": [453499, 446088]},
    {"name": "DramaWave", "productIds": [483859, 486163]},
]


def load_platforms_from_db() -> list[dict]:
    """从 platforms 表读取启用的平台。读不到 / 出错时回落硬编码。

    返回结构:
      [
        {
          "name":         "DramaWave",   # 显示名（同时也写入 ranking_snapshot.platform）
          "key":          "dramawave",   # 内部小写 key
          "platform_id":  12,            # platforms.id (内部主键)
          "productIds":   [483859, 486163],  # DataEye listPlayletDistribution 用的 productId
        },
        ...
      ]
    """
    try:
        if not DB_PATH.exists():
            log("⚠️  数据库未初始化，使用硬编码平台兜底")
            return _wrap_fallback()
        conn = sqlite3.connect(str(DB_PATH), timeout=10)
        try:
            rows = conn.execute(
                "SELECT id, name, product_ids, is_active FROM platforms "
                "WHERE is_active = 1 ORDER BY id ASC"
            ).fetchall()
        finally:
            conn.close()
        if not rows:
            log("⚠️  platforms 表为空，使用硬编码平台兜底")
            return _wrap_fallback()
        out: list[dict] = []
        for pid, name, product_ids_raw, _active in rows:
            try:
                product_ids = json.loads(product_ids_raw or "[]")
                if not isinstance(product_ids, list):
                    product_ids = []
            except json.JSONDecodeError:
                product_ids = []
            out.append({
                "name": name,
                "key": (name or "").lower(),
                "platform_id": int(pid),
                "productIds": [int(x) for x in product_ids if str(x).isdigit()],
            })
        debug(f"从数据库加载 {len(out)} 个启用平台: " + ", ".join(p["name"] for p in out))
        return out
    except Exception as e:
        log(f"⚠️  读取 platforms 表失败({e})，使用硬编码兜底")
        return _wrap_fallback()


def _wrap_fallback() -> list[dict]:
    return [
        {"name": p["name"], "key": p["name"].lower(),
         "platform_id": None, "productIds": list(p["productIds"])}
        for p in FALLBACK_PLATFORMS
    ]

# ---------------------------------------------------------------------------
# API 地址
# ---------------------------------------------------------------------------
URL_LIST = "https://oversea-v2.dataeye.com/api/product/listPlayletDistribution"
URL_DETAIL = "https://oversea-v2.dataeye.com/api/playlet/getPlayletInfo"
URL_TREND = "https://oversea-v2.dataeye.com/api/playlet/listTrendByPlaylet"

# ---------------------------------------------------------------------------
# [material-preview] TODO: 素材视频 URL 抓取尚未实现
# ---------------------------------------------------------------------------
# 现状（已实测，2026-04-28）：
#   - getPlayletInfo 返回的 mediaList 只是广告投放渠道清单
#     （如 [{id:501, mediaName:"AdMob", logoUrl:"..."}]），不含视频本体
#   - adxPlayletList 在 DramaWave 样本上为空数组
#   - creativeCnt / materialCnt 仅是计数，没有素材链接
#
# 方案备选（任意一条都需要再做一次 DataEye JS 逆向 + 签名验证）：
#   A. 找到 DataEye 后台真正的素材列表接口（可能是 listMaterial / getMaterial 等），
#      复用 compute_sign 调用，从中取 videoUrl + coverUrl
#   B. 通过 productList 的 storeType + productId 反查应用商店的预览视频
#   C. 接入第三方素材库
#
# 落地原则（由产品需求确定，不可违反）：
#   - **不允许伪造素材链接**
#   - 抓取失败不能影响剧集榜单主流程
#   - 写库时 ON DUPLICATE KEY 仅更新素材自身字段，绝不触碰 drama / drama_review
#
# 任何后续实现请保持本函数签名不变，方便 upsert_drama 后挂载调用：
def try_fetch_material_preview(cookie: str, playlet_id: str, headers: dict) -> dict | None:
    """[material-preview] 占位：返回 None 表示当前暂无可抓取素材。

    返回结构（实现后必须遵循）：
        {
            "video_url": str,   # 必填，HTML5 video 可直接播放的 URL
            "cover_url": str | None,
            "source":    str,   # 例如 "dataeye:listMaterial"
            "raw":       dict,  # 原始响应，落 raw_payload 列
        }
    """
    debug(f"[material-preview] try_fetch skipped (no impl) playletId={playlet_id}")
    return None

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

COUNTRY_LANG_MAP = {
    "美国": "English", "加拿大": "English", "英国": "English", "澳大利亚": "English",
    "巴西": "Portuguese", "葡萄牙": "Portuguese",
    "墨西哥": "Spanish", "西班牙": "Spanish", "阿根廷": "Spanish", "哥伦比亚": "Spanish", "智利": "Spanish", "秘鲁": "Spanish",
    "法国": "French",
    "德国": "German", "奥地利": "German",
    "印度尼西亚": "Indonesian", "印尼": "Indonesian",
    "越南": "Vietnamese",
    "韩国": "Korean",
    "日本": "Japanese",
    "俄罗斯": "Russian",
    "阿联酋": "Arabic", "沙特阿拉伯": "Arabic", "埃及": "Arabic",
    "泰国": "Thai",
    "土耳其": "Turkish",
    "意大利": "Italian",
    "印度": "Hindi",
    "中国": "Chinese", "台湾": "Chinese", "香港": "Chinese",
    "荷兰": "Dutch",
    "波兰": "Polish",
    "菲律宾": "English",
    "马来西亚": "English",
    "新加坡": "English",
    "尼日利亚": "English",
    "南非": "English",
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
        safe = text.encode(sys.stdout.encoding or "ascii", errors="replace").decode(sys.stdout.encoding or "ascii", errors="replace")
        print(safe, flush=True)


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


def _request_with_retry(url: str, payload: dict, headers: dict, max_retries: int = 3) -> requests.Response:
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, data=payload, headers=headers, timeout=30)
            return resp
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as e:
            log(f"  ⚠️ 网络请求失败 (第{attempt}/{max_retries}次): {e}")
            if attempt < max_retries:
                wait = attempt * 5
                log(f"  ⏳ {wait}秒后重试...")
                time.sleep(wait)
            else:
                raise


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
    resp = _request_with_retry(URL_LIST, payload, headers)
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
    resp = _request_with_retry(URL_DETAIL, payload, headers)
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
    resp = _request_with_retry(URL_TREND, payload, headers)
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
def detect_language(text: str, country_list: list | None = None) -> str:
    if text and detect:
        try:
            code = detect(text)
            result = LANG_MAP.get(code, "")
            if result:
                debug(f"语种识别: code={code} -> {result}")
                return result
            debug(f"语种识别: code={code} 未在映射表中")
        except Exception as e:
            debug(f"语种识别异常: {e}")
    else:
        debug(f"语种识别跳过: text={'空' if not text else '有'}, langdetect={'已安装' if detect else '未安装'}")

    if country_list:
        from collections import Counter
        lang_counts: Counter[str] = Counter()
        for c in country_list:
            name = c.get("countryName", "") if isinstance(c, dict) else str(c)
            lang = COUNTRY_LANG_MAP.get(name, "")
            if lang:
                lang_counts[lang] += 1
        if lang_counts:
            best = lang_counts.most_common(1)[0][0]
            debug(f"语种由投放国家推断: {best} (国家数={len(country_list)})")
            return best

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

    # B3-c 同步：append 到线上 sync buffer（不影响本地写入）
    sync_buffer.add_drama(info, language)


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

    # B3-c 同步：写完 SQLite 后 append 到线上 sync buffer
    sync_buffer.add_ranking(platform, snapshot_date, playlet_id,
                             rank, heat_value, material_count, invest_days)


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

    # B3-c 同步（即使本地 skipped 也尝试同步线上，由线上 ON DUPLICATE 决定）
    sync_buffer.add_trend(platform, playlet_id, date, daily_count)


# ---------------------------------------------------------------------------
# 主抓取流程
# ---------------------------------------------------------------------------
def scrape_platform(cookie: str, headers: dict, conn: sqlite3.Connection,
                    platform: dict, snapshot_date: str):
    platform_name = platform["name"]
    platform_key  = platform.get("key") or platform_name.lower()
    platform_id   = platform.get("platform_id")
    product_ids   = platform["productIds"]

    if not product_ids:
        log(f"❌ {platform_name} platform_id not configured (platforms.product_ids 为空) — 跳过")
        log_error(f"{platform_name} platform_id not configured")
        return

    # 平台开始计数（汇总日志用）
    p_started = stats["success"] + stats["fail"]
    drama_started = stats["new_drama"]
    upd_started   = stats["updated"]

    log(f"📡 正在抓取 {platform_name} | key={platform_key} platform_id={platform_id} "
        f"productIds={product_ids} date={snapshot_date}")
    debug(f"scrape_platform() 开始: platform_name={platform_name}, key={platform_key}, "
          f"platform_id={platform_id}, productIds={product_ids}, date={snapshot_date}")

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
                country_list = detail.get("countryList", [])
                language = detect_language(description, country_list)
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
                    # B3-c 同步：最小化插入也同步到线上
                    sync_buffer.add_minimal_drama(playlet_id, title)

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

    # B3-c 双写：本地 commit 之后，把本平台 buffer 一次性 flush 到线上
    try:
        sync_buffer.flush(label=platform_name)
    except Exception as e:
        log(f"  ⚠️  {platform_name} sync flush 异常（不影响本地）：{e}")
        log_error(f"sync flush {platform_name}: {traceback.format_exc()}")

    p_total = (stats["success"] + stats["fail"]) - p_started
    p_new   = stats["new_drama"] - drama_started
    p_upd   = stats["updated"]   - upd_started
    log(f"  🏁 {platform_name} 完成 | 处理={p_total} 新增剧={p_new} 更新剧={p_upd}")


def backfill_trends(cookie: str, headers: dict, conn: sqlite3.Connection):
    """补抓已入库剧集的历史趋势数据（trend 接口支持 startDate/endDate）。
    榜单排名快照不补抓——listPlayletDistribution 不支持历史日期查询。"""
    log("⚠️  榜单接口不支持历史补抓，已跳过伪历史写入")
    log("📈 仅补抓历史趋势数据（invest_trend）...")

    rows = conn.execute(
        "SELECT playlet_id, first_air_date FROM drama WHERE first_air_date IS NOT NULL AND first_air_date != ''"
    ).fetchall()
    log(f"  共 {len(rows)} 部剧集需要补抓趋势")

    today_str = datetime.now().strftime("%Y-%m-%d")
    for idx, (playlet_id, first_seen) in enumerate(rows, 1):
        try:
            existing_count = conn.execute(
                "SELECT COUNT(*) FROM invest_trend WHERE playlet_id = ?", (playlet_id,)
            ).fetchone()[0]
            if existing_count > 7:
                debug(f"[{idx}/{len(rows)}] {playlet_id} 已有 {existing_count} 条趋势，跳过")
                continue

            debug(f"[{idx}/{len(rows)}] 补抓趋势: {playlet_id}, {first_seen} ~ {today_str}")
            trend_data = fetch_trend(cookie, playlet_id, first_seen, today_str, headers)
            inserted = 0
            for t in trend_data:
                stat_date = t.get("statDate", "")
                num = t.get("num", 0)
                if stat_date:
                    platform_rows = conn.execute(
                        "SELECT DISTINCT platform FROM ranking_snapshot WHERE playlet_id = ?",
                        (playlet_id,),
                    ).fetchall()
                    for (plat,) in platform_rows:
                        insert_trend(conn, playlet_id, plat, stat_date, num)
                        inserted += 1
            if inserted:
                debug(f"  写入 {inserted} 条趋势")
            time.sleep(2)
        except Exception as e:
            debug(f"  趋势补抓失败 {playlet_id}: {e}")
            log_error(f"backfill trend {playlet_id}: {e}")

    conn.commit()
    log("📈 趋势补抓完成")


def run(backfill_days: int = 0, only_platform: str | None = None):
    log("=" * 60)
    log("DramaTracker DataEye 数据抓取")
    log("=" * 60)
    debug(f"脚本启动: Python {sys.version}")
    debug(f"工作目录: {os.getcwd()}")
    debug(f"BASE_DIR: {BASE_DIR}")
    debug(f"DB_PATH: {DB_PATH}")
    debug(f"CONFIG_PATH: {CONFIG_PATH}")
    debug(f"langdetect 可用: {detect is not None}")
    if only_platform:
        log(f"🎯 单平台模式: 仅抓取 {only_platform}")

    cookie = load_cookie()
    headers = build_headers(cookie)
    conn = get_db()

    # B3-c 双写：开抓前先重试历史失败队列
    if sync_buffer.is_enabled():
        log("📤 B3-c 双写已启用 → 同步目标: " + sync_buffer.SERVER_URL)
        try:
            sync_buffer.retry_failed_queue()
        except Exception as e:
            log(f"⚠️  失败队列重试异常（不影响主抓取）：{e}")
            log_error(f"retry_failed_queue: {traceback.format_exc()}")
    else:
        log("ℹ️  未配置 DT_SYNC_TOKEN，仅本地 SQLite 写入（不同步线上）")

    today_str = datetime.now().strftime("%Y-%m-%d")

    # 无论是否 backfill，ranking 只抓今天（接口只返回当前排名）
    log(f"\n{'─' * 40}")
    log(f"📅 抓取当天榜单: {today_str}")
    log(f"{'─' * 40}")

    # 优先从 platforms 表读取启用平台；失败 fallback 硬编码
    all_platforms = load_platforms_from_db()

    # --platform 单平台过滤（按 name / key，大小写不敏感）
    if only_platform:
        norm = only_platform.strip().lower()
        platforms_to_run = [p for p in all_platforms
                            if p["name"].lower() == norm or p.get("key") == norm]
        if not platforms_to_run:
            log(f"❌ 未找到平台 '{only_platform}'。可用: " +
                ", ".join(p["name"] for p in all_platforms))
            log_error(f"--platform '{only_platform}' not found in platforms table")
            conn.close()
            sys.exit(2)
        log(f"📋 单平台模式过滤后 {len(platforms_to_run)} 个: " +
            ", ".join(p["name"] for p in platforms_to_run))
    else:
        platforms_to_run = all_platforms
        log(f"📋 启用平台共 {len(platforms_to_run)} 个: " +
            ", ".join(p["name"] for p in platforms_to_run))

    for plat_idx, platform in enumerate(platforms_to_run, 1):
        try:
            log(f"\n--- 平台 [{plat_idx}/{len(platforms_to_run)}] ---")
            scrape_platform(cookie, headers, conn, platform, today_str)
        except SystemExit:
            raise
        except Exception as e:
            log(f"❌ 平台 {platform['name']} 整体失败: {e}")
            log_error(f"platform {platform['name']}: {traceback.format_exc()}")

    # backfill 模式：仅补抓趋势历史数据
    if backfill_days > 0:
        log(f"\n{'─' * 40}")
        log(f"📅 历史补抓模式: 补抓趋势数据")
        log(f"{'─' * 40}")
        backfill_trends(cookie, headers, conn)
        # B3-c：backfill 末尾 flush（trend 数据可能未走平台 flush）
        try:
            sync_buffer.flush(label="backfill")
        except Exception as e:
            log(f"⚠️  backfill sync flush 异常：{e}")
            log_error(f"sync flush backfill: {traceback.format_exc()}")

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

    # B3-c 双写：打印同步汇总
    if sync_buffer.is_enabled():
        sync_buffer.report()

    debug("脚本执行结束")


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"[启动] dataeye_scraper.py 被调用, __name__={__name__}", flush=True)
    print(f"[启动] 命令行参数: {sys.argv}", flush=True)
    parser = argparse.ArgumentParser(description="DataEye 海外短剧数据抓取")
    parser.add_argument("--backfill", type=int, default=0, help="补抓过去N天数据")
    parser.add_argument("--platform", type=str, default=None,
                        help="只抓取指定平台 (按 platforms.name 或 key, 大小写不敏感, 例: --platform DramaWave)")
    args = parser.parse_args()
    print(f"[启动] 解析参数: backfill={args.backfill}, platform={args.platform}", flush=True)
    run(backfill_days=args.backfill, only_platform=args.platform)
