"""
sync_buffer.py — 爬虫 B3-c 双写策略：本地 SQLite（source of truth）+ 线上同步 API。

工作模式：
  1. dataeye_scraper.py 在每次 upsert_*/insert_* 写完 SQLite 后，
     调用本模块的 add_drama/add_ranking/add_trend 把数据 append 到内存 buffer。
  2. 每抓完一个平台 (scrape_platform 末尾 commit 之后)，调用 flush(label) 把
     buffer 一次性 POST 到线上 /api/sync/*。
  3. 任何一个 batch 同步失败（含重试 3 次后），整个 batch payload 写入
     scraper-data/sync-failed.jsonl，不影响本地 SQLite 数据。
  4. run() 启动时先调用 retry_failed_queue()，重试历史失败队列。

优势：本地数据始终一致；线上偶发网络故障不会丢数据；下次启动自动补齐。
"""
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Tuple

import requests

# ── 路径 ─────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent  # dramatracker/
QUEUE_FILE = BASE_DIR / "data" / "sync-failed.jsonl"
ENV_FILE = BASE_DIR / ".env.local"


# ── 加载 .env.local（拿 DT_SERVER_URL / DT_SYNC_TOKEN）───────────────────────
def _load_env() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k not in os.environ:
            os.environ[k] = v


_load_env()

SERVER_URL = os.environ.get("DT_SERVER_URL", "http://localhost:3000").rstrip("/")
SYNC_TOKEN = os.environ.get("DT_SYNC_TOKEN", "")
SOURCE = os.environ.get("DT_SOURCE", "local-scraper")
BATCH_SIZE = int(os.environ.get("DT_BATCH_SIZE", "100"))
TIMEOUT = int(os.environ.get("DT_SYNC_TIMEOUT", "30"))
MAX_RETRIES = 3

log = logging.getLogger("sync-buffer")
if not log.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("[%(asctime)s][sync] %(message)s", "%H:%M:%S"))
    log.addHandler(h)
    log.setLevel(logging.INFO)


# ── 全局 buffer ──────────────────────────────────────────────────────────────
_buffer = {
    "dramas": [],   # list of drama dict（按 playlet_id 在 flush 时去重）
    "rankings": {}, # (platform, date_key, ranking_type) -> list of ranking dict
    "trends": {},   # platform -> list of trend dict
}
_stats = {"sent_batches": 0, "failed_batches": 0, "retried_ok": 0, "retried_fail": 0}


def is_enabled() -> bool:
    """是否开启同步：必须配置了 SYNC_TOKEN。"""
    return bool(SYNC_TOKEN) and SERVER_URL.startswith(("http://", "https://"))


# ── 收集 API ─────────────────────────────────────────────────────────────────
def add_drama(info: dict, language: str) -> None:
    """从 dataeye 原始 detail dict 转换为 sync API 接受的字段，加入 buffer。"""
    if not is_enabled():
        return
    tags_raw = info.get("playletTags", [])
    if not isinstance(tags_raw, list):
        tags_raw = []
    playlet_id = str(info.get("playletId", ""))
    if not playlet_id:
        return
    _buffer["dramas"].append({
        "playlet_id": playlet_id,
        "title": info.get("playletName", "") or "",
        "language": language,
        "description": info.get("playletbrief", "") or "",
        "cover_url": info.get("coverOss", "") or "",
        "first_air_date": info.get("firstSeen", "") or "",
        "tags": tags_raw,
        "creative_count": int(info.get("creativeCnt", 0) or 0),
        "first_seen_at": info.get("firstSeen", "") or "",
    })


def add_minimal_drama(playlet_id: str, title: str) -> None:
    """详情接口失败时的最小化插入对应的同步项。"""
    if not is_enabled() or not playlet_id:
        return
    _buffer["dramas"].append({
        "playlet_id": str(playlet_id),
        "title": title or playlet_id,
        "language": "Unknown",
    })


def add_ranking(platform: str, date_key: str, playlet_id: str,
                rank: int, heat_value: float, material_count: int,
                invest_days: int, ranking_type: str = "heat") -> None:
    if not is_enabled() or not playlet_id:
        return
    key = (platform, date_key, ranking_type)
    _buffer["rankings"].setdefault(key, []).append({
        "playlet_id": str(playlet_id),
        "rank_position": int(rank or 0),
        "heat_value": float(heat_value or 0),
        "material_count": int(material_count or 0),
        "invest_days": int(invest_days or 0),
    })


def add_trend(platform: str, playlet_id: str, date: str, daily_count: int) -> None:
    if not is_enabled() or not playlet_id or not date:
        return
    _buffer["trends"].setdefault(platform, []).append({
        "playlet_id": str(playlet_id),
        "date": date,
        "daily_invest_count": int(daily_count or 0),
    })


# ── HTTP ─────────────────────────────────────────────────────────────────────
def _post(endpoint: str, payload: dict) -> Tuple[bool, str]:
    url = f"{SERVER_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {SYNC_TOKEN}",
        "Content-Type": "application/json",
        "X-Sync-Source": SOURCE,
    }
    last_msg = ""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
            if resp.status_code == 200:
                return True, resp.text[:200]
            last_msg = f"HTTP {resp.status_code} {resp.text[:200]}"
            log.warning(f"  retry {attempt}/{MAX_RETRIES} {endpoint} -> {last_msg}")
        except requests.RequestException as e:
            last_msg = f"network: {e}"
            log.warning(f"  retry {attempt}/{MAX_RETRIES} {endpoint} -> {last_msg}")
        if attempt < MAX_RETRIES:
            time.sleep(2 * attempt)
    return False, last_msg


def _enqueue_failed(endpoint: str, payload: dict, reason: str) -> None:
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "endpoint": endpoint,
        "reason": reason,
        "payload": payload,
    }
    with open(QUEUE_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _stats["failed_batches"] += 1


def _send(endpoint: str, payload: dict, label: str) -> bool:
    ok, msg = _post(endpoint, payload)
    if ok:
        _stats["sent_batches"] += 1
        log.info(f"  ✓ {label} -> {msg[:120]}")
        return True
    log.error(f"  ✗ {label} 全部重试失败 -> 入队 sync-failed.jsonl：{msg}")
    _enqueue_failed(endpoint, payload, msg)
    return False


# ── flush / retry ────────────────────────────────────────────────────────────
def flush(label: str = "") -> None:
    """把当前 buffer 全部 POST 到线上；无论成功失败都清空 buffer
    （失败的已写入 sync-failed.jsonl）。"""
    if not is_enabled():
        return

    # dramas（按 playlet_id 去重，保留最后一次）
    dramas = _buffer["dramas"]
    if dramas:
        seen: dict[str, dict] = {}
        for d in dramas:
            seen[d["playlet_id"]] = d
        unique = list(seen.values())
        for i in range(0, len(unique), BATCH_SIZE):
            batch = unique[i:i + BATCH_SIZE]
            _send("/api/sync/dramas",
                  {"source": SOURCE, "dramas": batch},
                  f"[{label}] dramas batch{i // BATCH_SIZE + 1}({len(batch)})")
    _buffer["dramas"] = []

    # rankings
    for (platform, date_key, ranking_type), items in list(_buffer["rankings"].items()):
        for i in range(0, len(items), BATCH_SIZE):
            batch = items[i:i + BATCH_SIZE]
            _send("/api/sync/rankings",
                  {"source": SOURCE, "platform": platform,
                   "date_key": date_key, "ranking_type": ranking_type,
                   "rankings": batch},
                  f"[{label}] rankings {platform}@{date_key} batch{i // BATCH_SIZE + 1}({len(batch)})")
    _buffer["rankings"] = {}

    # trends
    for platform, items in list(_buffer["trends"].items()):
        for i in range(0, len(items), BATCH_SIZE):
            batch = items[i:i + BATCH_SIZE]
            _send("/api/sync/invest-trends",
                  {"source": SOURCE, "platform": platform, "trends": batch},
                  f"[{label}] trends {platform} batch{i // BATCH_SIZE + 1}({len(batch)})")
    _buffer["trends"] = {}


def retry_failed_queue() -> None:
    """启动时重试历史失败队列。"""
    if not is_enabled():
        return
    if not QUEUE_FILE.exists() or QUEUE_FILE.stat().st_size == 0:
        log.info("失败队列为空，无需重试")
        return

    lines = [ln for ln in QUEUE_FILE.read_text(encoding="utf-8").splitlines() if ln.strip()]
    log.info(f"♻️  开始重试失败队列：{len(lines)} 条")
    still_failed: list[str] = []
    for line in lines:
        try:
            entry = json.loads(line)
        except Exception:
            log.warning(f"  跳过损坏行：{line[:80]}")
            continue
        ok, msg = _post(entry["endpoint"], entry["payload"])
        if ok:
            _stats["retried_ok"] += 1
            log.info(f"  ✓ retry ok: {entry['endpoint']}")
        else:
            _stats["retried_fail"] += 1
            entry["reason"] = msg
            entry["ts"] = datetime.now().isoformat(timespec="seconds")
            still_failed.append(json.dumps(entry, ensure_ascii=False))
    if still_failed:
        QUEUE_FILE.write_text("\n".join(still_failed) + "\n", encoding="utf-8")
    else:
        QUEUE_FILE.write_text("", encoding="utf-8")
    log.info(f"♻️  队列重试完成：成功 {_stats['retried_ok']}，仍失败 {_stats['retried_fail']}")


def report() -> None:
    """打印同步汇总。"""
    log.info("─" * 50)
    log.info(f"📤 同步汇总：sent={_stats['sent_batches']} failed={_stats['failed_batches']} "
             f"retried_ok={_stats['retried_ok']} retried_fail={_stats['retried_fail']}")
    if QUEUE_FILE.exists():
        size = QUEUE_FILE.stat().st_size
        log.info(f"   失败队列文件：{QUEUE_FILE} ({size} bytes)")
    log.info("─" * 50)


def get_stats() -> dict:
    return dict(_stats)
