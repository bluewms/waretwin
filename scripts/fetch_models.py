#!/usr/bin/env python3
"""Download the model Release assets and verify their recorded SHA-256 hashes."""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "glb" / "manifest.json"


def matches(path, model):
    if not path.is_file() or path.stat().st_size != model["size"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == model["sha256"]


def download(url, destination, model):
    temporary = None
    try:
        request = Request(url, headers={"User-Agent": "BlueWMS-WareTwin-models"})
        with urlopen(request, timeout=60) as response:
            with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".part", delete=False) as output:
                temporary = Path(output.name)
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        if not matches(temporary, model):
            raise ValueError("下载文件的大小或 SHA-256 与清单不符")
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="下载并校验 WareTwin GLB 模型。")
    parser.add_argument("--check", action="store_true", help="仅校验本地模型，不访问网络")
    parser.add_argument("--only", action="append", metavar="FILENAME", help="只处理指定文件，可重复传入")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "glb", help="模型保存目录")
    parser.add_argument("--force", action="store_true", help="允许替换与清单不一致的本地文件")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    models = manifest["models"]
    if args.only:
        unknown = set(args.only) - {model["filename"] for model in models}
        if unknown:
            parser.error("清单中没有这些模型：" + ", ".join(sorted(unknown)))
        models = [model for model in models if model["filename"] in args.only]
    base_url = "https://github.com/{}/releases/download/{}".format(
        manifest["repository"], quote(manifest["release"], safe=""),
    )
    failed = False
    for model in models:
        name = model["filename"]
        if Path(name).name != name or name in {".", ".."}:
            raise ValueError("模型清单包含无效文件名")
        destination = args.output_dir / name
        if matches(destination, model):
            print(f"已校验：{name}")
            continue
        if args.check or (destination.exists() and not args.force):
            print(f"缺失或校验失败：{name}" + ("" if args.check else "；如需替换请使用 --force"), file=sys.stderr)
            failed = True
            continue
        try:
            args.output_dir.mkdir(parents=True, exist_ok=True)
            print(f"下载：{name}", flush=True)
            download(base_url + "/" + quote(model["asset"], safe=""), destination, model)
            print(f"已校验：{name}")
        except (OSError, ValueError) as error:
            print(f"下载失败：{name}：{error}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
