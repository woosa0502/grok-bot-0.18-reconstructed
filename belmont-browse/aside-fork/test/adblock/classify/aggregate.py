#!/usr/bin/env python3
"""Aggregate aside_rule_classifier TSV output into an implementation-scope table.

usage: aggregate.py <classified.tsv> [--md out.md]
"""
import collections, re, sys

rows = [l.rstrip("\n").split("\t", 5) for l in open(sys.argv[1], encoding="utf-8", errors="replace")]
rows = [r for r in rows if len(r) == 6]
by_file = collections.defaultdict(list)
for r in rows:
    by_file[r[0]].append(r)

def opt_names(line):
    """Option names after the last '$' of a network rule (lowercase, ~ stripped, no value)."""
    d = line.rfind("$")
    if d < 0 or line.startswith("@@") and d < 2:
        return []
    out = []
    for p in line[d + 1:].split(","):
        p = p.strip()
        if not p:
            continue
        neg = p.startswith("~")
        name = p.lstrip("~").split("=", 1)[0].lower()
        out.append(("~" if neg else "") + name)
    return out

def is_regex(line):
    body = line[2:] if line.startswith("@@") else line
    d = body.rfind("$")
    pat = body[:d] if d > 0 else body
    return len(pat) >= 2 and pat.startswith("/") and pat.endswith("/")

md = []
for f, rs in by_file.items():
    n_ok_url = sum(1 for r in rs if r[2] == "url")
    n_ok_style = sum(1 for r in rs if r[2] == "style")
    errs = [r for r in rs if r[2] == "err"]
    md.append(f"## {f}: url ok {n_ok_url}, style ok {n_ok_style}, rejected {len(errs)}")
    reasons = collections.Counter(r[3] for r in errs)
    md.append("\n| rejected reason | lines |\n|---|---|")
    for k, v in reasons.most_common():
        md.append(f"| {k} | {v} |")
    # unknown option -> which option
    unk = collections.Counter()
    for r in errs:
        if r[3] == "UNKNOWN_OPTION":
            unk[r[4].lower()] += 1
    md.append("\n### UNKNOWN_OPTION by option (first failing option only)\n\n| option | lines |\n|---|---|")
    for k, v in unk.most_common(40):
        md.append(f"| `{k}` | {v} |")
    # every option present on rejected network lines (a line may carry several)
    allopts = collections.Counter()
    for r in errs:
        if r[3] in ("UNKNOWN_OPTION", "NOT_A_TRISTATE_OPTION", "NO_VALUE_PROVIDED", "ALLOWLIST_ONLY_OPTION", "DEPRECATED_OPTION", "UNSUPPORTED_FEATURE", "not indexable") and "##" not in r[5] and "#@#" not in r[5] and "#?#" not in r[5] and "#$#" not in r[5]:
            for o in set(opt_names(r[5])):
                allopts[o] += 1
    md.append("\n### all options appearing on rejected network lines\n\n| option | lines |\n|---|---|")
    for k, v in allopts.most_common(40):
        md.append(f"| `{k}` | {v} |")
    # cosmetic
    cos = collections.Counter()
    for r in errs:
        if r[3] == "unsupported selector":
            cos[r[4]] += 1
        elif r[3] in ("WRONG_CSS_RULE_DELIM", "EMPTY_CSS_SELECTOR", "UNSUPPORTED_FEATURE") and re.search(r"#[@?$%]*#", r[5]):
            m = re.search(r"#[@?$%]*#", r[5])
            cos["delim " + m.group(0) + (" (~domain)" if r[4].startswith("~") else "")] += 1
    md.append("\n### cosmetic rejections by feature\n\n| feature | lines |\n|---|---|")
    for k, v in cos.most_common(40):
        md.append(f"| `{k}` | {v} |")
    # other reasons with tokens
    other = collections.Counter()
    for r in errs:
        if r[3] not in ("UNKNOWN_OPTION", "unsupported selector"):
            other[(r[3], r[4][:30])] += 1
    md.append("\n### other rejections (reason, token)\n\n| reason | token | lines |\n|---|---|---|")
    for (k, t), v in other.most_common(30):
        md.append(f"| {k} | `{t}` | {v} |")
    # silently mis-handled among accepted: regex patterns treated as literal substrings
    rx = [r for r in rs if r[2] == "url" and is_regex(r[5])]
    md.append(f"\n### accepted but semantically different\n\n- regex-pattern rules (`/…/`) indexed as literal text: **{len(rx)}**")
    for r in rx[:8]:
        md.append(f"  - `{r[5][:100]}`")
    md.append("")
print("\n".join(md))
