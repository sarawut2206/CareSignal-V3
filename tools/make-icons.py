# -*- coding: utf-8 -*-
"""โลโก้ชุดของ V3 — ต้องต่างจาก V2 ชัดเจนเมื่ออยู่บนหน้าจอมือถือเครื่องเดียวกัน
   V2 = โล่สีน้ำเงินมีแท่งกราฟ (รุ่นกล้อง)
   V3 = นาฬิกาจับเวลาสีเขียวมรกตมีหัวใจ (ลูกหลานจับเวลาให้ ไม่ใช้กล้อง)
   วาดใหญ่ 4 เท่าแล้วย่อ เพื่อให้ขอบเรียบโดยไม่ต้องใช้ไลบรารีเพิ่ม"""
from PIL import Image, ImageDraw
import os

OUT = "C:/Users/KruSam/Downloads/CareSignal-V3/"
S = 2048                      # ผืนผ้าใบตอนวาด
G1, G2 = (16, 185, 129), (5, 122, 109)   # เขียวมรกต → เขียวน้ำทะเล
GOLD = (255, 201, 60)
WHITE = (255, 255, 255)

def bg(size, radius_pct):
    """พื้นไล่สีแนวทแยง มุมมนตามสัดส่วนที่ขอ"""
    g = Image.new("RGB", (64, 64))
    px = g.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126.0
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(G1, G2))
    im = g.resize((size, size), Image.BICUBIC).convert("RGBA")
    if radius_pct:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1],
                                            radius=int(size * radius_pct), fill=255)
        im.putalpha(m)
    return im

def mark(im, scale, stroke=WHITE):
    """นาฬิกาจับเวลา + หัวใจ · scale = สัดส่วนความกว้างของเครื่องหมายเทียบกับผืนผ้าใบ"""
    d = ImageDraw.Draw(im)
    W = im.size[0]
    cx, cy = W / 2.0, W / 2.0 + W * 0.035          # เผื่อที่ให้ปุ่มกดด้านบน
    r = W * scale / 2.0                             # รัศมีวงนอกของเรือน
    w = r * 0.20                                    # ความหนาเส้น

    # เรือนนาฬิกา
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=stroke, width=int(round(w)))
    # ปุ่มกดด้านบนและก้าน
    stem_h = r * 0.30
    d.rounded_rectangle([cx - w * 0.62, cy - r - stem_h, cx + w * 0.62, cy - r + w * 0.4],
                        radius=w * 0.5, fill=stroke)
    bw = r * 0.46
    d.rounded_rectangle([cx - bw / 2, cy - r - stem_h - w * 1.15, cx + bw / 2, cy - r - stem_h + w * 0.2],
                        radius=w * 0.55, fill=stroke)
    # ปุ่มข้างซ้าย (เอียง 45 องศาแบบนาฬิกาจับเวลาจริง)
    k = (r + w * 0.15) * 0.7071
    d.line([(cx - k * 0.98, cy - k * 0.98), (cx - k * 1.30, cy - k * 1.30)],
           fill=stroke, width=int(round(w * 0.9)))

    # หัวใจสีทองกลางเรือน — ครอบครัวเป็นคนวัดให้
    hs = r * 0.92                                   # ความกว้างหัวใจ
    hx, hy = cx, cy + hs * 0.06
    lobe = hs * 0.30
    d.ellipse([hx - hs / 2, hy - lobe * 1.45, hx - hs / 2 + lobe * 2, hy + lobe * 0.55], fill=GOLD)
    d.ellipse([hx + hs / 2 - lobe * 2, hy - lobe * 1.45, hx + hs / 2, hy + lobe * 0.55], fill=GOLD)
    d.polygon([(hx - hs / 2 + lobe * 0.04, hy - lobe * 0.42),
               (hx + hs / 2 - lobe * 0.04, hy - lobe * 0.42),
               (hx, hy + hs * 0.60)], fill=GOLD)
    return im

def build(path, size, radius_pct, scale):
    im = mark(bg(S, radius_pct), scale)
    im.resize((size, size), Image.LANCZOS).save(OUT + path)
    print("เขียน", path, size)

# ไอคอนแอปทั่วไป (มุมมน) และแบบ maskable (เต็มกรอบ เครื่องหมายเล็กลงให้อยู่ในเขตปลอดภัย)
build("icon-192.png", 192, 0.22, 0.62)
build("icon-512.png", 512, 0.22, 0.62)
build("icon-maskable-192.png", 192, 0.0, 0.46)
build("icon-maskable-512.png", 512, 0.0, 0.46)
build("apple-touch-icon.png", 180, 0.0, 0.60)      # iOS มนมุมให้เอง
build("favicon-64.png", 64, 0.18, 0.66)

# logo-mark: ใช้บนแถบหัวเว็บ พื้นโปร่งใส เหลือเฉพาะเครื่องหมาย
lm = mark(Image.new("RGBA", (S, S), (0, 0, 0, 0)), 0.72, (13, 148, 109))   #เส้นเขียวเพื่อให้เห็นบนพื้นขาว
lm.resize((512, 512), Image.LANCZOS).save(OUT + "logo-mark.png")
print("เขียน logo-mark.png 512 (พื้นโปร่งใส)")
for f in ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-64.png", "logo-mark.png"]:
    print(" ", f, os.path.getsize(OUT + f), "ไบต์")
