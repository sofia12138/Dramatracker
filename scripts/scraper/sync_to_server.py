#!/usr/bin/env python3
"""
DramaTracker 本地抓取脚本 → 服务器同步工具

使用方法：
  python sync_to_server.py dramas   <dramas.json>
  python sync_to_server.py rankings <rankings.json> --platform ShortMax --date 2026-04-10
  python sync_to_server.py trends   <trends.json>   --platform ShortMax

环境变量（.env 或直接 export）：
  DT_SERVER_URL   = https://your-server.com
  DT_SYNC_TOKEN   = your-bearer-token
  DT_SOURCE       = local-scraper
  DT_BATCH_SIZE   = 100

dramas.json 格式（数组）：
[
  {
    "playlet_id": "xxx",
    "title": "剧名",
    "language": "en",
    "description": "简介",
    "cover_url": "https://...",
    "first_air_date": "2026-01-01",
    "tags": ["动作", "爱情"],
    "creative_count": 12,
    "first_seen_at": "2026-04-01"
  },
  ...
]

rankings.json 格式（数组）：
[
  {
    "playlet_id": "xxx",
    "rank_position": 1,
    "heat_value": 9999.5,
    "heat_increment": 100.2,
    "material_count": 55,
    "invest_days": 7
  },
  ...
]

trends.json 格式（数组）：
[
  {
    "playlet_id": "xxx",
    "date": "2026-04-10",
    "daily_invest_count": 42
  },
  ...
]
"""

import os
import sys
import json
import time
import argparse
import logging
from datetime import datetime
from pathlib import Path

# ── 第三方依赖（仅 requests，轻量） ─────────────────────────────────────────────
try:
    import requests
except ImportError:
    print("[ERROR] 缺少 requests 库，请先安装：pip install requests")
    sys.exit(1)

# ── 读取 .env ────────────────────────────────────────────────────────────────
def load_dotenv(path: str = ".env") -> None:
    if not Path(path).exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k not in os.environ:
                    os.environ[k] = v

load_dotenv()

# ── 配置 ─────────────────────────────────────────────────────────────────────
SERVER_URL   = os.environ.get("DT_SERVER_URL", "http://localhost:3000").rstrip("/")
SYNC_TOKEN   = os.environ.get("DT_SYNC_TOKEN", "")
SOURCE       = os.environ.get("DT_SOURCE", "local-scraper")
BATCH_SIZE   = int(os.environ.get("DT_BATCH_SIZE", "100"))
MAX_RETRIES  = 3
RETRY_DELAY  = 2  # 秒

# ── 日志 ─────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("dt-sync")

# ── HTTP 请求 ────────────────────────────────────────────────────────────────
def post_with_retry(endpoint: str, payload: dict) -> dict:
    url = f"{SERVER_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {SYNC_TOKEN}",
        "Content-Type": "application/json",
        "X-Sync-Source": SOURCE,
    }

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 401:
                log.error("认证失败，请检查 DT_SYNC_TOKEN 环境变量")
                sys.exit(1)
            else:
                log.warning(f"请求失败（尝试 {attempt}/{MAX_RETRIES}）：HTTP {resp.status_code} - {resp.text[:200]}")
        except requests.RequestException as e:
            log.warning(f"网络错误（尝试 {attempt}/{MAX_RETRIES}）：{e}")

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_DELAY * attempt)

    raise RuntimeError(f"请求 {url} 失败，已重试 {MAX_RETRIES} 次")


def chunked(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


# ── 同步 dramas ──────────────────────────────────────────────────────────────
def sync_dramas(json_path: str) -> None:
    with open(json_path, encoding="utf-8") as f:
        dramas = json.load(f)

    log.info(f"开始同步 dramas：共 {len(dramas)} 条，批次大小 {BATCH_SIZE}")
    total_inserted = total_updated = total_failed = 0

    for i, batch in enumerate(chunked(dramas, BATCH_SIZE), 1):
        payload = {"source": SOURCE, "dramas": batch}
        result = post_with_retry("/api/sync/dramas", payload)
        total_inserted += result.get("inserted", 0)
        total_updated  += result.get("updated", 0)
        total_failed   += result.get("failed", 0)
        log.info(f"  批次 {i}: inserted={result.get('inserted',0)} updated={result.get('updated',0)} failed={result.get('failed',0)}")

    log.info(f"dramas 同步完成：inserted={total_inserted} updated={total_updated} failed={total_failed}")


# ── 同步 rankings ────────────────────────────────────────────────────────────
def sync_rankings(json_path: str, platform: str, date: str, ranking_type: str = "heat") -> None:
    with open(json_path, encoding="utf-8") as f:
        rankings = json.load(f)

    log.info(f"开始同步 rankings：platform={platform} date={date} 共 {len(rankings)} 条")
    total_inserted = total_skipped = total_failed = 0

    for i, batch in enumerate(chunked(rankings, BATCH_SIZE), 1):
        payload = {
            "source": SOURCE,
            "platform": platform,
            "date_key": date,
            "ranking_type": ranking_type,
            "rankings": batch,
        }
        result = post_with_retry("/api/sync/rankings", payload)
        total_inserted += result.get("inserted", 0)
        total_skipped  += result.get("skipped", 0)
        total_failed   += result.get("failed", 0)
        log.info(f"  批次 {i}: inserted={result.get('inserted',0)} skipped={result.get('skipped',0)} failed={result.get('failed',0)}")

    log.info(f"rankings 同步完成：inserted={total_inserted} skipped={total_skipped} failed={total_failed}")


# ── 同步 trends ──────────────────────────────────────────────────────────────
def sync_trends(json_path: str, platform: str) -> None:
    with open(json_path, encoding="utf-8") as f:
        trends = json.load(f)

    log.info(f"开始同步 invest-trends：platform={platform} 共 {len(trends)} 条")
    total_inserted = total_skipped = total_failed = 0

    for i, batch in enumerate(chunked(trends, BATCH_SIZE), 1):
        payload = {"source": SOURCE, "platform": platform, "trends": batch}
        result = post_with_retry("/api/sync/invest-trends", payload)
        total_inserted += result.get("inserted", 0)
        total_skipped  += result.get("skipped", 0)
        total_failed   += result.get("failed", 0)
        log.info(f"  批次 {i}: inserted={result.get('inserted',0)} skipped={result.get('skipped',0)} failed={result.get('failed',0)}")

    log.info(f"invest-trends 同步完成：inserted={total_inserted} skipped={total_skipped} failed={total_failed}")


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    if not SYNC_TOKEN:
        log.error("DT_SYNC_TOKEN 未设置，请配置同步令牌")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="DramaTracker 本地 -> 服务器数据同步工具")
    sub = parser.add_subparsers(dest="cmd")

    # dramas
    p_dramas = sub.add_parser("dramas", help="同步剧目基础数据")
    p_dramas.add_argument("json_file", help="dramas.json 路径")

    # rankings
    p_rank = sub.add_parser("rankings", help="同步榜单快照数据")
    p_rank.add_argument("json_file", help="rankings.json 路径")
    p_rank.add_argument("--platform", required=True, help="平台名称，如 ShortMax")
    p_rank.add_argument("--date", required=True, help="快照日期 YYYY-MM-DD")
    p_rank.add_argument("--type", default="heat", help="榜单类型：heat/new/invest（默认 heat）")

    # trends
    p_trend = sub.add_parser("trends", help="同步投放趋势数据")
    p_trend.add_argument("json_file", help="trends.json 路径")
    p_trend.add_argument("--platform", required=True, help="平台名称")

    args = parser.parse_args()

    if args.cmd == "dramas":
        sync_dramas(args.json_file)
    elif args.cmd == "rankings":
        sync_rankings(args.json_file, args.platform, args.date, args.type)
    elif args.cmd == "trends":
        sync_trends(args.json_file, args.platform)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
