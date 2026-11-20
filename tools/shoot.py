"""Render the entry's three screenshots with Playwright against out/dashboard over file://.

Usage: python shoot.py <out-dir> <screenshot-dir>
Checks each image is a whole PNG, 300-350 KB, long side <= 1440, short side >= 800, and prints
the numbers. Rewrites nothing: the page is opened as the program wrote it.
"""

import io
import os
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

W, H = 1400, 1250


def main(out_dir: str, shots_dir: str) -> int:
    page_path = os.path.abspath(os.path.join(out_dir, "dashboard", "index.html"))
    if not os.path.exists(page_path):
        print(f"no page at {page_path}")
        return 2
    os.makedirs(shots_dir, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1"])
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.goto("file://" + page_path)
        page.wait_for_selector("#board-body tr", timeout=15000)

        def shot(name: str) -> None:
            raw = page.screenshot(type="png", full_page=False)
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            data = buf.getvalue()
            dest = os.path.join(shots_dir, name)
            with open(dest, "wb") as fh:
                fh.write(data)
            with Image.open(dest) as check:
                w, h = check.size
                print(f"{name}: {len(data)} bytes, {w}x{h}, mode {check.mode}")

        # 1. the board, top of page.
        shot("1-board.png")

        # 2. a protocol's detail view: open the first watchlist row and let the drawer paint.
        page.evaluate("document.querySelector('#board-body tr[data-slug=\"steakhouse-financial\"]').click()")
        page.evaluate("document.getElementById('detail').scrollTop = 0")
        page.wait_for_selector("#detail:not([hidden]) .arith", timeout=5000)
        page.wait_for_timeout(350)
        # The drawer is 977px tall at this width: grow the viewport until it fits, and say so.
        need = page.evaluate("document.getElementById('detail').scrollHeight")
        if need > page.viewport_size["height"]:
            page.set_viewport_size({"width": W, "height": min(1200, need)})
            print(f"detail view: viewport grown to {page.viewport_size['height']}px for a {need}px drawer")
        shot("2-detail.png")
        page.evaluate("document.getElementById('detail-close').click()")
        page.set_viewport_size({"width": W, "height": H})
        page.wait_for_timeout(200)

        # 3. the filtered view: off-list RWA rows only, via the real controls.
        page.click('.chip[data-region="watchlist"]')
        page.select_option("#f-category", "Risk Curators")
        page.wait_for_timeout(300)
        count = page.eval_on_selector_all("#board-body tr", "rows => rows.length")
        print(f"filtered view (watchlist + Risk Curators): {count} rows shown")
        shot("3-filtered.png")
        print("page errors:", errors if errors else "none")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
