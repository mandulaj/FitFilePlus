#!/usr/bin/env python3
"""Inline src/ and vendor/ into one self-contained file: fitfileplus.html

  python3 build.py                      -> fitfileplus.html
  python3 build.py --embed run.fit out.html   -> test/demo build with that activity baked in
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def build(embed=None, out=ROOT / "fitfileplus.html"):
    html = (ROOT / "src/index.html").read_text(encoding="utf-8")

    def inline(m):
        text = (ROOT / m.group(1)).read_text(encoding="utf-8")
        return text.replace("</script", "<\\/script").replace("</style", "<\\/style")

    html = re.sub(r"/\*INLINE:([\w./-]+)\*/", inline, html)
    payload = ""
    if embed:
        data = base64.b64encode(Path(embed).read_bytes()).decode()
        payload = "window.FITFILEPLUS_EMBED=" + json.dumps({"name": Path(embed).name, "data": data}) + ";"
    html = html.replace("/*EMBED*/", payload)
    Path(out).write_text(html, encoding="utf-8")
    print(f"wrote {out} ({len(html) / 1024:.0f} KB)")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--embed":
        build(sys.argv[2], sys.argv[3])
    else:
        build()
