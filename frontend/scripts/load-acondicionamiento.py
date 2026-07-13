#!/usr/bin/env python3
import json
import sys
import openpyxl

path = sys.argv[1] if len(sys.argv) > 1 else "/workspace/SEMANAS 2026.xlsx"
wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
ws = wb["ACONDICIONAMIENTO"]
rows = []
for row in ws.iter_rows(values_only=True):
    rows.append([str(c) if c is not None else "" for c in row])
print(json.dumps(rows))
