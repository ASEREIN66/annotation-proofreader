#!/usr/bin/env python3
"""生成插件图标：圆角方块 + 对勾。仅用标准库，3 倍超采样抗锯齿。"""
import math
import os
import struct
import zlib

SS = 3  # 超采样倍数
BG = (37, 99, 235, 255)      # 蓝底
FG = (255, 255, 255, 255)    # 白勾


def rounded_rect_alpha(x, y, size, radius):
    """返回该点在圆角矩形内的覆盖率"""
    if x < 0 or y < 0 or x >= size or y >= size:
        return 0.0
    r = radius
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    d = math.hypot(x - cx, y - cy)
    if d <= r - 0.5:
        return 1.0
    if d >= r + 0.5:
        return 0.0
    return (r + 0.5 - d)


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def check_alpha(x, y, size):
    w = size * 0.105
    p1 = (size * 0.27, size * 0.53)
    p2 = (size * 0.43, size * 0.68)
    p3 = (size * 0.74, size * 0.34)
    best = min(
        seg_dist(x, y, *p1, *p2),
        seg_dist(x, y, *p2, *p3),
    )
    if best <= w - 0.5:
        return 1.0
    if best >= w + 0.5:
        return 0.0
    return (w + 0.5 - best)


def render(size):
    n = size * SS
    buf = bytearray()
    radius = size * 0.24 * SS
    for py in range(n):
        buf.append(0)  # PNG 每行首字节为过滤器类型
        for px in range(n):
            # 采样点取像素中心
            sx = (px + 0.5) / SS
            sy = (py + 0.5) / SS
            a_bg = rounded_rect_alpha(sx, sy, size, size * 0.24)
            a_fg = check_alpha(sx, sy, size)
            # 先铺背景，再叠前景
            r = BG[0] * a_bg
            g = BG[1] * a_bg
            b = BG[2] * a_bg
            a = 255 * a_bg
            ra = a_fg * (1 - a_bg)  # 前景只在背景外补，简化合成
            r = r * (1 - a_fg) + FG[0] * a_fg
            g = g * (1 - a_fg) + FG[1] * a_fg
            b = b * (1 - a_fg) + FG[2] * a_fg
            a = a * (1 - a_fg) + 255 * a_fg
            buf += bytes((int(r), int(g), int(b), int(a)))
    return bytes(buf)


def write_png(path, size):
    raw = render(size)
    n = size * SS

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"{path}  {size}x{size}  {len(png)} bytes")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 48, 128):
        write_png(os.path.join(out, f"icon{s}.png"), s)
