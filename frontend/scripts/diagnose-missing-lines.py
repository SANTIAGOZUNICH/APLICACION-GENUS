#!/usr/bin/env python3
"""Diagnóstico geometría ACONDICIONAMIENTO — líneas faltantes."""
import json
import re
import subprocess
import sys
import urllib.request

XLSX = "/workspace/SEMANAS 2026.xlsx"
BASE = sys.argv[1] if len(sys.argv) > 1 else ""

WEEK_DAYS = ["lunes", "martes", "miercoles", "jueves", "viernes"]


def normalize_key(s: str) -> str:
    import unicodedata
    s = s.strip().lower()
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def row_text(row):
    return " ".join(c.strip() for c in row if c.strip()).lower()


def is_week_anchor(row):
    t = normalize_key(row_text(row))
    return all(d in t for d in WEEK_DAYS)


def extract_day_columns(row):
    m = {}
    for i, cell in enumerate(row):
        k = normalize_key(cell)
        if k == "lunes": m[i] = "Lunes"
        elif k == "martes": m[i] = "Martes"
        elif k in ("miercoles", "miércoles"): m[i] = "Miércoles"
        elif k == "jueves": m[i] = "Jueves"
        elif k == "viernes": m[i] = "Viernes"
    return m


def parse_line_cell(cell: str):
    n = normalize_key(cell)
    m = re.match(r"^linea\s*(\d+)\b", n)
    if m: return f"Línea {m.group(1)}"
    m = re.match(r"^l(\d+)$", n)
    if m: return f"Línea {m.group(1)}"
    m = re.match(r"^linea\s*n[°º]?\s*(\d+)", n)
    if m: return f"Línea {m.group(1)}"
    m = re.match(r"^premium\s*([ab])$", n)
    if m: return f"Premium {m.group(1).upper()}"
    return None


def detect_line_header(row):
    for cell in row:
        if not cell.strip(): continue
        line = parse_line_cell(cell.strip())
        if line: return line
    cells = [c.strip() for c in row if c.strip()]
    if 0 < len(cells) <= 4:
        joined = normalize_key(" ".join(cells))
        m = re.search(r"\blinea\s*(\d+)\b", joined)
        if m and len(cells) <= 2:
            return f"Línea {m.group(1)}"
    return None


def detect_sector(row):
    t = normalize_key(row_text(row))
    if "envasado consumo masivo" in t or "consumo masivo" in t:
        return "ENVASADO_MASIVO"
    if "envasado productos premiun" in t or "productos premiun" in t or "premium" in t:
        return "ENVASADO_PREMIUM"
    return None


def col_letter(n):
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def scan_context(rows, target_row, target_col):
    ctx = {
        "sector_header": None, "sector_header_row": None,
        "line_header": None, "line_header_row": None,
        "active_sector": None, "active_line": None,
        "week_row": None, "day_label": None, "nearby": [],
    }
    day_columns = {}
    current_sector = None
    current_line = None

    for i, row in enumerate(rows):
        row_num = i + 1
        if is_week_anchor(row):
            day_columns = extract_day_columns(row)
            ctx["week_row"] = row_num
            current_line = None  # reset line on new week?
            continue

        sector = detect_sector(row)
        if sector:
            current_sector = sector
            line = detect_line_header(row)
            if line:
                current_line = line
            if row_num <= target_row:
                ctx["sector_header"] = " | ".join(c.strip() for c in row if c.strip())
                ctx["sector_header_row"] = row_num
                if line:
                    ctx["line_header"] = line
                    ctx["line_header_row"] = row_num
            continue

        line = detect_line_header(row)
        if line:
            current_line = line
            if row_num <= target_row:
                ctx["line_header"] = line
                ctx["line_header_row"] = row_num
            continue

        if row_num == target_row:
            for ci, day in day_columns.items():
                if ci + 1 == target_col:
                    ctx["day_label"] = day
            for ci, cell in enumerate(row):
                if cell.strip():
                    ctx["nearby"].append(f"{col_letter(ci+1)}{row_num}={cell.strip()[:40]}")
            for back in range(1, 8):
                prev = rows[i - back] if i >= back else None
                if not prev: break
                cells = [f"{col_letter(ci+1)}={c.strip()[:25]}" for ci, c in enumerate(prev) if c.strip()]
                if cells:
                    ctx["nearby"].insert(0, f"r{row_num-back}: {', '.join(cells[:5])}")

    ctx["active_sector"] = current_sector
    ctx["active_line"] = current_line
    return ctx


def parse_range(sr):
    m = re.match(r"^([^!]+)!(\d+):(\d+)$", sr or "")
    if not m: return None
    return {"sheet": m.group(1), "row": int(m.group(2)), "col": int(m.group(3))}


def fetch_api_items():
    if not BASE: return []
    import os
    bypass = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET", "")
    items = []
    for sector in ("ENVASADO_MASIVO", "ENVASADO_PREMIUM"):
        req = urllib.request.Request(f"{BASE}/api/v1/work-items?sector={sector}")
        req.add_header("Accept", "application/json")
        if bypass:
            req.add_header("x-vercel-protection-bypass", bypass)
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            items.extend(data.get("workItems", []))
    return items


def main():
    rows = json.loads(subprocess.check_output(["python3", "/workspace/frontend/scripts/load-acondicionamiento.py"]))
    items = fetch_api_items()
    print(f"Rows: {len(rows)}, API items: {len(items)}")

    missing = [i for i in items if i.get("sector") in ("ENVASADO_MASIVO", "ENVASADO_PREMIUM") and not i.get("line")]
    masivo = [i for i in missing if i["sector"] == "ENVASADO_MASIVO"]
    premium = [i for i in missing if i["sector"] == "ENVASADO_PREMIUM"]
    print(f"Sin línea: {len(missing)} (Masivo={len(masivo)}, Premium={len(premium)})")

    def pick(arr, n):
        if len(arr) <= n: return arr
        step = max(1, len(arr) // n)
        return [arr[min(i * step, len(arr)-1)] for i in range(n)]

    selected = pick(masivo, 12) + pick(premium, 8)

    print("\n| # | Sector | sourceRange | sectorHdr | lineHdr | activeLine | producto |")
    print("|---|--------|-------------|-----------|---------|------------|----------|")
    for i, item in enumerate(selected[:25]):
        loc = parse_range(item.get("sourceRange", ""))
        ctx = scan_context(rows, loc["row"], loc["col"]) if loc else {}
        print(
            f"| {i+1} | {item['sector']} | {item.get('sourceRange','?')} "
            f"| r{ctx.get('sector_header_row','?')} {(ctx.get('sector_header') or '—')[:25]} "
            f"| r{ctx.get('line_header_row','?')} {ctx.get('line_header') or '—'} "
            f"| {ctx.get('active_line') or 'null'} "
            f"| {(item.get('product') or item.get('plannedProduct') or '—')[:22]} |"
        )

    # Scan all rows for line header variants in sheet
    variants = {}
    for i, row in enumerate(rows):
        for ci, cell in enumerate(row):
            c = cell.strip()
            if not c: continue
            nk = normalize_key(c)
            if "linea" in nk or re.match(r"^l\d+$", nk) or "premium" in nk:
                key = c[:50]
                variants.setdefault(key, []).append(f"r{i+1}{col_letter(ci+1)}")

    print("\n## Variantes de línea en sheet (muestra)")
    for k, locs in list(variants.items())[:30]:
        print(f"  '{k}' → {', '.join(locs[:4])}{'...' if len(locs)>4 else ''}")

    # Count weeks
    weeks = [i+1 for i, row in enumerate(rows) if is_week_anchor(row)]
    print(f"\n## Semanas detectadas en filas: {weeks[:15]}{'...' if len(weeks)>15 else ''} ({len(weeks)} total)")

    print("\n## Detalle casos 1-3")
    for i, item in enumerate(selected[:3]):
        loc = parse_range(item.get("sourceRange", ""))
        ctx = scan_context(rows, loc["row"], loc["col"]) if loc else {}
        print(json.dumps({"case": i+1, "item": {k: item.get(k) for k in ("sector","product","sourceRange","weekLabel","dayLabel")}, "ctx": ctx}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
