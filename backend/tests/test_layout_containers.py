"""组织级容器模板：隔离、唯一名称、木托盘颜色、尺寸校验、被引用禁止删除。"""
import json
import sqlite3

import pytest

from app.layout_containers import WOOD_COLOR, ContainerTemplates
from app.layout_errors import LayoutConflict, LayoutNotFound

PALLET = {'name': '塑料托盘 1100', 'type': 'plastic_pallet', 'color': '#2255AA', 'width': 1.1, 'depth': 1.1, 'height': 0.15}


def store(tmp):
    return ContainerTemplates(str(tmp))


def _tmp(name):
    import tempfile, os
    return os.path.join(tempfile.mkdtemp(), name)


def test_create_list_and_isolation():
    s = store(_tmp('c.db'))
    created = s.create('org-a', PALLET)
    assert created['color'] == '#2255aa' and created['width'] == 1.1
    assert [t['name'] for t in s.list('org-a')] == ['塑料托盘 1100']
    assert s.list('org-b') == []
    assert s.get_many('org-b', [created['id']]) == {}
    assert list(s.get_many('org-a', [created['id'], 'missing'])) == [created['id']]
    with pytest.raises(LayoutNotFound):
        s.update('org-b', created['id'], PALLET)


def test_duplicate_name_is_conflict_case_insensitive():
    s = store(_tmp('c.db'))
    s.create('org-a', {**PALLET, 'name': 'Box A', 'type': 'plastic_box'})
    with pytest.raises(LayoutConflict):
        s.create('org-a', {**PALLET, 'name': 'box a'})
    s.create('org-b', {**PALLET, 'name': 'box a'})  # other organisation is independent
    other = s.create('org-a', {**PALLET, 'name': 'Box B'})
    with pytest.raises(LayoutConflict):
        s.update('org-a', other['id'], {**PALLET, 'name': 'BOX A'})


def test_wood_pallet_color_is_fixed():
    s = store(_tmp('c.db'))
    wood = s.create('org-a', {**PALLET, 'name': '木托盘 1200', 'type': 'wood_pallet', 'color': '#ff0000'})
    assert wood['color'] == WOOD_COLOR


def test_invalid_values_rejected():
    s = store(_tmp('c.db'))
    for bad in ({**PALLET, 'width': 0}, {**PALLET, 'depth': -1}, {**PALLET, 'height': float('nan')}, {**PALLET, 'width': True},
                {**PALLET, 'type': 'metal_pallet'}, {**PALLET, 'name': '  '}, {**PALLET, 'color': 'red'}, {**PALLET, 'width': 11}):
        with pytest.raises(ValueError):
            s.create('org-a', bad)


def _revision_with(path, org, document):
    db = sqlite3.connect(path)
    db.executescript("""CREATE TABLE IF NOT EXISTS layout_warehouses (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS layout_revisions (id TEXT PRIMARY KEY, warehouse_id TEXT NOT NULL, state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, document TEXT NOT NULL);""")
    db.execute("INSERT INTO layout_warehouses VALUES('w1',?,'W')", (org,))
    db.execute("INSERT INTO layout_revisions(id,warehouse_id,state,document) VALUES('r1','w1','draft',?)",
               (json.dumps(document, separators=(',', ':')),))
    db.commit(); db.close()


def test_delete_referenced_is_refused():
    path = _tmp('c.db')
    s = store(path)
    used = s.create('org-a', PALLET)
    unused = s.create('org-a', {**PALLET, 'name': 'unused'})
    _revision_with(path, 'org-a', {'ground_batches': [{'id': 'g', 'container_id': used['id']}]})
    with pytest.raises(LayoutConflict):
        s.delete('org-a', used['id'])
    s.delete('org-a', unused['id'])
    assert [t['id'] for t in s.list('org-a')] == [used['id']]
    with pytest.raises(LayoutNotFound):
        s.delete('org-b', used['id'])
