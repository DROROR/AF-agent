#!/usr/bin/env python3
"""
Renders a small Markdown subset to a PDF using nothing but the standard
library, because this host has neither pip nor any PDF tool and the guide
has to be shareable as a file.

Deliberately narrow: headings, paragraphs, bullets, numbered items and
**bold** / *italic* runs. Anything richer belongs in a real typesetter, not
here - this exists to produce one readable handout, not to be a converter.
"""
import re, sys, zlib

W, H = 595.28, 841.89                      # A4 points
ML, MR, MT, MB = 56, 56, 64, 56
BODY, LEAD = 10.5, 15.5

# WinAnsi has no em dash at the codepoint latin-1 maps it to, so a typographic
# character silently became "?" in the first build. Fold the ones a Markdown
# document actually produces down to what the built-in fonts can draw.
TYPOGRAPHIC = {
    "\u2014": " - ", "\u2013": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u00a0": " ",
    "\u2022": chr(0xB7), "\u00d7": "x"
}

def esc(s):
    for a, b in TYPOGRAPHIC.items():
        s = s.replace(a, b)
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

WIDTHS = {}
def width(text, size, bold=False):
    # Helvetica advance widths are close enough to uniform for wrapping at
    # this size; 0.5 em is the standard rough average and errs narrow, so a
    # line never overflows the measured column.
    return len(text) * size * (0.53 if bold else 0.5)

def wrap(text, size, bold, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if width(trial, size, bold) <= maxw or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def runs(text):
    """Split **bold** and *italic* into (text, font) pairs."""
    out, i = [], 0
    for m in re.finditer(r"\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`", text):
        if m.start() > i: out.append((text[i:m.start()], "F1"))
        if m.group(1): out.append((m.group(1), "F2"))
        elif m.group(2): out.append((m.group(2), "F3"))
        else: out.append((m.group(3), "F4"))
        i = m.end()
    if i < len(text): out.append((text[i:], "F1"))
    return out or [(text, "F1")]

def parse(md):
    blocks = []
    for raw in md.split("\n"):
        line = raw.rstrip()
        if not line.strip(): blocks.append(("gap", "")); continue
        if line.startswith("### "): blocks.append(("h3", line[4:]))
        elif line.startswith("## "): blocks.append(("h2", line[3:]))
        elif line.startswith("# "): blocks.append(("h1", line[2:]))
        elif re.match(r"^[-*] ", line): blocks.append(("li", line[2:]))
        elif re.match(r"^\d+\. ", line): blocks.append(("ol", line))
        else: blocks.append(("p", line))
    return blocks

class Page:
    def __init__(self): self.ops, self.y = [], H - MT
    def room(self, n): return self.y - n >= MB

def render(blocks):
    pages, p = [], Page()
    def newpage():
        nonlocal p
        pages.append(p); p = Page()
    for kind, text in blocks:
        if kind == "gap":
            p.y -= 6; continue
        size, bold, gap_before, indent = BODY, False, 0, 0
        if kind == "h1": size, bold, gap_before = 20, True, 10
        elif kind == "h2": size, bold, gap_before = 14, True, 16
        elif kind == "h3": size, bold, gap_before = 11.5, True, 10
        elif kind in ("li", "ol"): indent = 16
        p.y -= gap_before
        avail = W - ML - MR - indent
        plain = re.sub(r"\*\*|\*|`", "", text)
        lines = wrap(plain, size, bold, avail)
        need = len(lines) * (size + 5) + 4
        if not p.room(need) and p.ops: newpage()
        if kind in ("h1", "h2", "h3"):
            for ln in lines:
                p.y -= size + 5
                p.ops.append(f"BT /F2 {size} Tf 1 0 0 1 {ML} {p.y:.1f} Tm ({esc(ln)}) Tj ET")
            p.y -= 4
        else:
            first = True
            for ln in lines:
                p.y -= LEAD
                x = ML + indent
                if kind in ("li", "ol") and first:
                    marker = "•" if kind == "li" else ln.split(".")[0] + "."
                    if kind == "ol": ln = ln.split(". ", 1)[1] if ". " in ln else ln
                    p.ops.append(f"BT /F1 {size} Tf 1 0 0 1 {ML + 2} {p.y:.1f} Tm ({esc(marker)}) Tj ET")
                first = False
                # Re-apply inline runs against the wrapped line where they survive.
                cursor, emitted = x, False
                for seg, font in runs(text if len(lines) == 1 else ln):
                    if not seg: continue
                    p.ops.append(f"BT /{font} {size} Tf 1 0 0 1 {cursor:.1f} {p.y:.1f} Tm ({esc(seg)}) Tj ET")
                    cursor += width(seg, size, font == "F2"); emitted = True
                if not emitted:
                    p.ops.append(f"BT /F1 {size} Tf 1 0 0 1 {x} {p.y:.1f} Tm ({esc(ln)}) Tj ET")
    pages.append(p)
    return [pg for pg in pages if pg.ops]

def build(pages, out):
    objs, kids = [], []
    font_objs = {"F1": "Helvetica", "F2": "Helvetica-Bold", "F3": "Helvetica-Oblique", "F4": "Courier"}
    base = 3 + len(font_objs)
    for i, pg in enumerate(pages):
        kids.append(base + i * 2)
    fonts = " ".join(f"/{k} {3+j} 0 R" for j, k in enumerate(font_objs))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(pages)} >>")
    for name, ps in font_objs.items():
        objs.append(f"<< /Type /Font /Subtype /Type1 /BaseFont /{ps} /Encoding /WinAnsiEncoding >>")
    for i, pg in enumerate(pages):
        n = base + i * 2
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W:.2f} {H:.2f}] /Resources << /Font << {fonts} >> >> /Contents {n+1} 0 R >>")
        stream = "\n".join(pg.ops).encode("latin-1", "replace")
        objs.append(("stream", stream))
    buf = bytearray(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs, start=1):
        offs.append(len(buf))
        if isinstance(o, tuple):
            data = zlib.compress(o[1])
            buf += f"{i} 0 obj\n<< /Length {len(data)} /Filter /FlateDecode >>\nstream\n".encode()
            buf += data + b"\nendstream\nendobj\n"
        else:
            buf += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(buf)
    buf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for off in offs: buf += f"{off:010d} 00000 n \n".encode()
    buf += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(out, "wb").write(buf)
    return len(pages)

if __name__ == "__main__":
    md = open(sys.argv[1], encoding="utf-8").read()
    n = build(render(parse(md)), sys.argv[2])
    print(f"{sys.argv[2]}: {n} page(s)")
