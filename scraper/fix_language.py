"""
一次性脚本：对 language='Unknown' 或 NULL 的剧集重新调用详情接口获取 countryList，更新语种。
运行: python scraper/fix_language.py
"""
import sqlite3
import sys
import os
import json
import hashlib
import time
import urllib.parse
import requests
from datetime import datetime
from pathlib import Path

try:
    from langdetect import detect
except ImportError:
    detect = None

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "dramatracker.db"
CONFIG_PATH = BASE_DIR / "data" / "config.json"

SIGN_SALT = "g:%w0k7&q1v9^tRnLz!M"
URL_DETAIL = "https://oversea-v2.dataeye.com/api/playlet/getPlayletInfo"

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


def compute_sign(params: dict) -> str:
    sorted_keys = sorted(params.keys())
    parts = []
    for k in sorted_keys:
        v = params[k]
        if isinstance(v, str):
            v = urllib.parse.quote(v.strip(), safe="")
        parts.append(f"{k}={v}")
    raw = "&".join(parts) + f"&key={SIGN_SALT}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest().upper()


def detect_language(text: str, country_list: list | None = None) -> str:
    if text and detect:
        try:
            code = detect(text)
            result = LANG_MAP.get(code, "")
            if result:
                return result
        except Exception:
            pass

    if country_list:
        from collections import Counter
        lang_counts: Counter[str] = Counter()
        for c in country_list:
            name = c.get("countryName", "") if isinstance(c, dict) else str(c)
            lang = COUNTRY_LANG_MAP.get(name, "")
            if lang:
                lang_counts[lang] += 1
        if lang_counts:
            return lang_counts.most_common(1)[0][0]

    return "Unknown"


def main():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    cookie = config.get("cookie", "")
    if not cookie:
        print("[错误] 未配置 Cookie")
        sys.exit(1)

    headers = {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Content-Language": "zh-cn",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": cookie,
        "S": hashlib.md5(datetime.now().strftime("%m/%d/%Y").encode()).hexdigest().upper(),
    }

    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")

    rows = conn.execute(
        "SELECT playlet_id, title, description FROM drama WHERE language IS NULL OR language = 'Unknown' OR language = ''"
    ).fetchall()

    print(f"[信息] 需要修复语种的剧集: {len(rows)} 部")
    if not rows:
        print("[完成] 无需修复")
        conn.close()
        return

    fixed = 0
    still_unknown = 0
    failed = 0

    for idx, (playlet_id, title, desc) in enumerate(rows, 1):
        try:
            this_times = str(int(time.time() * 1000))
            payload = {"playletId": playlet_id, "thisTimes": this_times}
            payload["sign"] = compute_sign(payload)

            resp = requests.post(URL_DETAIL, data=payload, headers=headers, timeout=30)
            data = resp.json()

            if data.get("statusCode") != 200:
                print(f"  [{idx}/{len(rows)}] {title[:30]} - API异常: {data.get('msg')}")
                failed += 1
                time.sleep(2)
                continue

            content = data.get("content", data.get("data"))
            if isinstance(content, list) and len(content) > 0:
                content = content[0]

            if not content or not isinstance(content, dict):
                print(f"  [{idx}/{len(rows)}] {title[:30]} - 详情为空")
                failed += 1
                time.sleep(2)
                continue

            brief = content.get("playletbrief", "") or ""
            country_list = content.get("countryList", [])
            new_lang = detect_language(brief, country_list)

            if brief and not desc:
                conn.execute(
                    "UPDATE drama SET language=?, description=?, updated_at=datetime('now') WHERE playlet_id=?",
                    (new_lang, brief, playlet_id),
                )
            else:
                conn.execute(
                    "UPDATE drama SET language=?, updated_at=datetime('now') WHERE playlet_id=?",
                    (new_lang, playlet_id),
                )

            if new_lang != "Unknown":
                fixed += 1
                print(f"  [{idx}/{len(rows)}] {title[:30]} -> {new_lang}")
            else:
                still_unknown += 1
                print(f"  [{idx}/{len(rows)}] {title[:30]} -> Unknown (无法识别)")

            if idx % 10 == 0:
                conn.commit()

            time.sleep(1)

        except Exception as e:
            print(f"  [{idx}/{len(rows)}] {title[:30]} - 异常: {e}")
            failed += 1
            time.sleep(1)

    conn.commit()
    conn.close()

    print(f"\n{'=' * 50}")
    print(f"修复完成:")
    print(f"  成功修复: {fixed} 部")
    print(f"  仍为Unknown: {still_unknown} 部")
    print(f"  失败: {failed} 部")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    main()
