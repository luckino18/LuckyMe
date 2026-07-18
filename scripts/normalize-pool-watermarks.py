from collections import deque
from pathlib import Path

from PIL import Image


ASSET_DIR = Path(__file__).resolve().parents[1] / "app-seeker" / "assets" / "pools"
NAMES = ("mini", "normal", "high", "premium")
CANVAS_SIZE = 512
ART_SIZE = 474
ALPHA_THRESHOLD = 36


def connected_medallion_bbox(alpha: Image.Image) -> tuple[int, int, int, int]:
    width, height = alpha.size
    pixels = alpha.load()
    start = (width // 2, height // 2)
    queue = deque([start])
    visited = bytearray(width * height)
    visited[start[1] * width + start[0]] = 1
    left = right = start[0]
    top = bottom = start[1]

    while queue:
        x, y = queue.popleft()
        if pixels[x, y] <= ALPHA_THRESHOLD:
            continue
        left = min(left, x)
        right = max(right, x)
        top = min(top, y)
        bottom = max(bottom, y)
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= next_x < width and 0 <= next_y < height):
                continue
            index = next_y * width + next_x
            if visited[index]:
                continue
            visited[index] = 1
            if pixels[next_x, next_y] > ALPHA_THRESHOLD:
                queue.append((next_x, next_y))

    pad = max(10, round(max(right - left, bottom - top) * 0.045))
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(width, right + pad + 1),
        min(height, bottom + pad + 1),
    )


for name in NAMES:
    path = ASSET_DIR / f"{name}-watermark-v1.png"
    image = Image.open(path).convert("RGBA")
    left, top, right, bottom = connected_medallion_bbox(image.getchannel("A"))
    side = min(right - left, bottom - top)
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    square = (
        center_x - side // 2,
        center_y - side // 2,
        center_x - side // 2 + side,
        center_y - side // 2 + side,
    )
    crop = image.crop(square)
    crop.thumbnail((ART_SIZE, ART_SIZE), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((CANVAS_SIZE - crop.width) // 2, (CANVAS_SIZE - crop.height) // 2))
    canvas.save(path, optimize=True)
    print(f"Normalized {path.name}: {crop.width}x{crop.height} on {CANVAS_SIZE}x{CANVAS_SIZE}")
