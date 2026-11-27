"""组织级容器模板（开发说明第二节）。只依赖标准库，与布局存储共用同一个 SQLite 文件。

模板按组织隔离：组织内名称不区分大小写唯一；木托盘颜色固定；
任一草稿或发布版本通过 container_id 引用某模板时，禁止删除该模板。
"""
from __future__ import annotations

import math
import re
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

from .layout_errors import LayoutConflict, LayoutNotFound

TYPES = ('plastic_pallet', 'wood_pallet', 'plastic_box')
WOOD_COLOR = '#b07a48'
DEFAULT_COLORS = {'plastic_pallet': '#2f6fb3', 'wood_pallet': WOOD_COLOR, 'plastic_box': '#3a9d6e'}
MAX_SIZE_M = 10.0
_COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')
_FIELDS = 'id,name,type,color,width,depth,height,created_at,updated_at'


def normalize(data: dict) -> dict:
    """校验并规范化模板字段；无效时抛 ValueError（路由映射为 422）。"""
    if not isinstance(data, dict):
        raise ValueError('Container template must be an object')
    name = data.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise ValueError('Container name is required (at most 80 characters)')
    kind = data.get('type')
    if kind not in TYPES:
        raise ValueError(f'Container type must be one of {", ".join(TYPES)}')
    dims = {}
    for key in ('width', 'depth', 'height'):
        value = data.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
                or value <= 0 or value > MAX_SIZE_M:
            raise ValueError(f'Container {key} must be a positive number of metres (at most {MAX_SIZE_M:g})')
        dims[key] = float(value)
    if kind == 'wood_pallet':
        color = WOOD_COLOR
    else:
        color = data.get('color') or DEFAULT_COLORS[kind]
        if not isinstance(color, str) or not _COLOR.match(color):
            raise ValueError('Container color must look like #RRGGBB')
        color = color.lower()
    return {'name': name.strip(), 'type': kind, 'color': color, **dims}


class ContainerTemplates:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS layout_container_templates (
                    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
                    name TEXT NOT NULL, type TEXT NOT NULL, color TEXT NOT NULL,
                    width REAL NOT NULL, depth REAL NOT NULL, height REAL NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE UNIQUE INDEX IF NOT EXISTS layout_container_name
                    ON layout_container_templates(organization_id, name COLLATE NOCASE);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def list(self, organization_id: str) -> list[dict]:
        with self.connection() as db:
            return [dict(r) for r in db.execute(
                f'SELECT {_FIELDS} FROM layout_container_templates WHERE organization_id=? ORDER BY name COLLATE NOCASE',
                (organization_id,))]

    def get_many(self, organization_id: str, ids) -> dict[str, dict]:
        ids = sorted({i for i in ids if isinstance(i, str)})
        if not ids:
            return {}
        with self.connection() as db:
            marks = ','.join('?' * len(ids))
            rows = db.execute(f'SELECT {_FIELDS} FROM layout_container_templates WHERE organization_id=? AND id IN ({marks})',
                              (organization_id, *ids))
            return {r['id']: dict(r) for r in rows}

    def _get(self, db, organization_id: str, template_id: str) -> dict:
        row = db.execute(f'SELECT {_FIELDS} FROM layout_container_templates WHERE organization_id=? AND id=?',
                         (organization_id, template_id)).fetchone()
        if row is None:
            raise LayoutNotFound('Container template not found')
        return dict(row)

    def create(self, organization_id: str, data: dict) -> dict:
        values = normalize(data)
        template_id = uuid.uuid4().hex
        try:
            with self.connection() as db:
                db.execute('INSERT INTO layout_container_templates(id,organization_id,name,type,color,width,depth,height) '
                           'VALUES(?,?,?,?,?,?,?,?)', (template_id, organization_id, values['name'], values['type'],
                                                       values['color'], values['width'], values['depth'], values['height']))
                return self._get(db, organization_id, template_id)
        except sqlite3.IntegrityError as exc:
            raise LayoutConflict('A container template with this name already exists') from exc

    def update(self, organization_id: str, template_id: str, data: dict) -> dict:
        values = normalize(data)
        try:
            with self.connection() as db:
                self._get(db, organization_id, template_id)
                db.execute('UPDATE layout_container_templates SET name=?,type=?,color=?,width=?,depth=?,height=?,'
                           'updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?',
                           (values['name'], values['type'], values['color'], values['width'], values['depth'],
                            values['height'], organization_id, template_id))
                return self._get(db, organization_id, template_id)
        except sqlite3.IntegrityError as exc:
            raise LayoutConflict('A container template with this name already exists') from exc

    def references(self, organization_id: str, template_id: str) -> int:
        """引用该模板的版本数量（草稿与发布）。布局文档以紧凑 JSON 保存，可直接按字段匹配。"""
        pattern = f'%"container_id":"{template_id}"%'
        with self.connection() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='layout_revisions'").fetchone()
            if not exists:
                return 0
            return db.execute('SELECT COUNT(*) FROM layout_revisions r JOIN layout_warehouses w ON w.id=r.warehouse_id '
                              'WHERE w.organization_id=? AND r.document LIKE ?', (organization_id, pattern)).fetchone()[0]

    def delete(self, organization_id: str, template_id: str) -> None:
        with self.connection() as db:
            self._get(db, organization_id, template_id)
        if self.references(organization_id, template_id):
            raise LayoutConflict('Container template is used by a saved layout and cannot be deleted')
        with self.connection() as db:
            db.execute('DELETE FROM layout_container_templates WHERE organization_id=? AND id=?', (organization_id, template_id))
