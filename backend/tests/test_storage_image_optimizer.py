"""Upload image optimization: browser-compressed JPEGs are stored as-is; no network required."""
import io
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.storage.optimization import ImageOptimizer, StorageOptimizer


def jpeg(size, orientation=None) -> bytes:
    img = Image.new("RGB", size, (120, 80, 40))
    buf = io.BytesIO()
    if orientation is None:
        img.save(buf, format="JPEG", quality=85)
    else:
        exif = Image.Exif()
        exif[0x0112] = orientation
        img.save(buf, format="JPEG", quality=85, exif=exif.tobytes())
    return buf.getvalue()


def test_upright_jpeg_within_limits_is_stored_untouched():
    raw = jpeg((1440, 1920), orientation=1)

    out, meta = StorageOptimizer().optimize_file(io.BytesIO(raw), "a.jpg", "image/jpeg")

    assert out.read() == raw
    assert meta["image_optimization"]["optimized_format"] == "JPEG"
    assert meta["file_hash"]  # dedup still works on the stored bytes


def test_jpeg_without_exif_is_stored_untouched():
    raw = jpeg((1920, 1080))

    out, meta = ImageOptimizer.optimize(io.BytesIO(raw))

    assert out.read() == raw
    assert meta["optimized"] is False


def test_rotated_jpeg_is_re_encoded_upright():
    raw = jpeg((1600, 900), orientation=6)

    out, meta = ImageOptimizer.optimize(io.BytesIO(raw))

    assert meta["optimized_format"] == "WebP"
    assert Image.open(out).size == (900, 1600)


def test_oversized_jpeg_is_resized_to_webp():
    raw = jpeg((4032, 3024))

    out, meta = ImageOptimizer.optimize(io.BytesIO(raw))

    img = Image.open(out)
    assert img.format == "WEBP"
    assert max(img.size) == 1920


def test_png_is_re_encoded_to_webp():
    buf = io.BytesIO()
    Image.new("RGBA", (800, 600), (0, 0, 0, 0)).save(buf, format="PNG")

    out, meta = ImageOptimizer.optimize(io.BytesIO(buf.getvalue()))

    assert meta["optimized_format"] == "WebP"
    assert Image.open(out).format == "WEBP"
