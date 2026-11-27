#!/usr/bin/env python3
"""签发后台工作台（/workspace）的本地访问密钥。只用标准库，不需要先安装后端依赖。

用法：python3 scripts/issue-workspace-key.py [--org 组织] [--user 用户] [--days 天数] [--db 路径]
密钥只打印一次；数据库中仅保存其 SHA-256 摘要（与 backend/app/layout_store.py 的 issue_access 一致）。
默认写入 backend/layouts.db，即在 backend 目录启动后端时 TWIN_LAYOUT_DB 的默认位置。
"""
import argparse
import hashlib
import secrets
import sqlite3
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--org', default='local-dev')
p.add_argument('--user', default='admin')
p.add_argument('--days', type=int, default=90)
p.add_argument('--db', default=str(Path(__file__).resolve().parents[1] / 'backend' / 'layouts.db'))
a = p.parse_args()
token = secrets.token_urlsafe(32)
with sqlite3.connect(a.db) as db:
    # 表结构与 LayoutStore 一致；后端启动时会补建其余表
    db.execute('CREATE TABLE IF NOT EXISTS layout_access_tokens (digest TEXT PRIMARY KEY, organization_id TEXT NOT NULL, '
               'user_id TEXT NOT NULL, expires_at REAL NOT NULL)')
    db.execute('INSERT INTO layout_access_tokens VALUES(?,?,?,?)',
               (hashlib.sha256(token.encode()).hexdigest(), a.org, a.user, time.time() + a.days * 86400))
print(f'组织 {a.org} / 用户 {a.user}，有效 {a.days} 天，数据库 {a.db}')
print(token)
