def normalize_bbox(
    rect: list[float] | tuple[float, ...],
    width: float,
    height: float,
    *,
    bottom_left: bool = False,
) -> dict[str, float] | None:
    if width <= 0 or height <= 0:
        return None
    x0, y0, x1, y1 = rect
    x0, x1 = sorted((max(0.0, min(width, x0)), max(0.0, min(width, x1))))
    y0, y1 = sorted((max(0.0, min(height, y0)), max(0.0, min(height, y1))))
    if bottom_left:
        y0, y1 = height - y1, height - y0
    if x1 <= x0 or y1 <= y0:
        return None
    return {
        "x": x0 / width,
        "y": y0 / height,
        "width": (x1 - x0) / width,
        "height": (y1 - y0) / height,
    }


def rotate_bbox(box: dict[str, float], degrees: int) -> dict[str, float]:
    x, y, w, h = (box[key] for key in ("x", "y", "width", "height"))
    angle = degrees % 360
    if angle == 90:
        return {"x": 1 - y - h, "y": x, "width": h, "height": w}
    if angle == 180:
        return {"x": 1 - x - w, "y": 1 - y - h, "width": w, "height": h}
    if angle == 270:
        return {"x": y, "y": 1 - x - w, "width": h, "height": w}
    if angle != 0:
        raise ValueError("PDF rotation must be a multiple of 90")
    return dict(box)
