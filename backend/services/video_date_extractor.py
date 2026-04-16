"""
Extract recording date from camcorder OSD text burned into the bottom-left
corner of video frames, using Apple Vision framework OCR.

The OSD format is two lines:
  Line 1: HH:MM
  Line 2: DD.MM.YYYY

Vision typically returns them joined with a space: "10:31 18.11.1995"
"""
import logging
import re
from datetime import datetime
from typing import Optional

from PIL import Image, ImageEnhance, ImageOps
from services.video_processor import extract_frames_batch

logger = logging.getLogger(__name__)

try:
    import Vision
    import Quartz
    _VISION_AVAILABLE = True
except ImportError:
    _VISION_AVAILABLE = False
    logger.warning("pyobjc-framework-Vision not installed — video date extraction unavailable")

# Pattern list: most specific first.
# Vision joins the two OSD lines with a space, giving e.g. "10:31 18.11.1995"
_PATTERNS = [
    # "10:31 18.11.1995" — time + 4-digit year date
    (re.compile(r'\b(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\b'), 'hm_dmy4'),
    # "10:31 18.11.95" — time + 2-digit year date
    (re.compile(r'\b(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{2})\b'), 'hm_dmy2'),
    # Date-only fallback: "18.11.1995"
    (re.compile(r'\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b'), 'dmy4'),
]


def _parse_date(text: str) -> Optional[datetime]:
    for pat, fmt in _PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        try:
            if fmt == 'hm_dmy4':
                h, mi, d, mo, y = g[0], g[1], g[2], g[3], g[4]
            elif fmt == 'hm_dmy2':
                h, mi, d, mo, yy = g[0], g[1], g[2], g[3], g[4]
                y = (1900 + yy) if yy >= 70 else (2000 + yy)
            elif fmt == 'dmy4':
                d, mo, y = g[0], g[1], g[2]
                h, mi = 0, 0
            else:
                continue
            if not (1 <= mo <= 12 and 1 <= d <= 31 and 1970 <= y <= 2030):
                continue
            if not (0 <= h <= 23 and 0 <= mi <= 59):
                continue
            return datetime(y, mo, d, h, mi, 0)
        except (ValueError, OverflowError):
            continue
    return None


def _ocr_pil_image(img: Image.Image) -> str:
    """Run Apple Vision text recognition on a PIL image. Returns recognised text or ''."""
    img_rgba = img.convert("RGBA")
    w, h = img_rgba.size
    raw = img_rgba.tobytes()  # keep reference alive while CGImage exists
    dp = Quartz.CGDataProviderCreateWithData(None, raw, len(raw), None)
    cg = Quartz.CGImageCreate(
        w, h, 8, 32, w * 4,
        Quartz.CGColorSpaceCreateDeviceRGB(),
        Quartz.kCGBitmapByteOrderDefault | Quartz.kCGImageAlphaPremultipliedLast,
        dp, None, False, Quartz.kCGRenderingIntentDefault,
    )
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setRecognitionLanguages_(["sk-SK", "cs-CZ", "en-US"])
    # Must disable language correction so digit strings aren't mangled
    req.setUsesLanguageCorrection_(False)
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, {})
    ok, _ = handler.performRequests_error_([req], None)
    if not ok:
        return ""
    parts = []
    for obs in (req.results() or []):
        candidates = obs.topCandidates_(1)
        if candidates:
            parts.append(str(candidates[0].string()))
    return " ".join(parts)


def extract_date_from_video(path: str) -> Optional[str]:
    """
    Sample 5 frames from the first ~60 s, OCR the bottom-left 35% × 20% crop,
    return the first valid ISO-8601 datetime string found, or None.
    """
    if not _VISION_AVAILABLE:
        return None

    try:
        timestamps = [0, 12_000, 24_000, 36_000, 48_000]
        frames = extract_frames_batch(path, timestamps, interval_s=0)
    except Exception as e:
        logger.warning("Frame extraction failed for %s: %s", path, e)
        return None

    for ts_ms, img in frames:
        w, h = img.size
        # Crop: bottom 20% of height, left 35% of width — where the OSD sits
        crop = img.crop((0, int(h * 0.80), int(w * 0.35), h))

        # Preprocess: grayscale → contrast boost → 2× upscale for better OCR
        crop = ImageOps.grayscale(crop)
        crop = ImageEnhance.Contrast(crop).enhance(2.5)
        cw, ch = crop.size
        crop = crop.resize((cw * 2, ch * 2), Image.LANCZOS)

        try:
            text = _ocr_pil_image(crop)
        except Exception as e:
            logger.debug("OCR error at %d ms in %s: %s", ts_ms, path, e)
            continue

        if not text.strip():
            continue

        logger.debug("OCR @%d ms in %s: %r", ts_ms, path, text)
        dt = _parse_date(text)
        if dt:
            logger.info("Date found in %s: %s", path, dt.isoformat())
            return dt.isoformat()

    logger.debug("No date found in %s", path)
    return None
