#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
临时补抓脚本：只跑 NetShort / Storeel / iDrama 三个今天遗漏的平台。
用法：cd dramatracker && python scraper/backfill_3platforms.py
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import dataeye_scraper as ds

TARGETS = {"HiShort"}
ds.PLATFORMS = [p for p in ds.PLATFORMS if p["name"] in TARGETS]
print(f"[backfill] 仅抓平台: {[p['name'] for p in ds.PLATFORMS]}", flush=True)

ds.run(backfill_days=0)
