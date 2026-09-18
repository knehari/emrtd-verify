import numpy as np
from PIL import Image, ImageFilter

from app.liveness import BLUR_VARIANCE_THRESHOLD, MIN_HEIGHT_PX, MIN_WIDTH_PX, _blur_variance, check_liveness


def _checkerboard(size: int = 200, square: int = 8) -> Image.Image:
    """Motif haute fréquence synthétique — sert de base "nette" pour les tests de flou.
    Ce n'est pas un visage : la détection de visage échouera dessus, comme attendu
    pour toute image synthétique non faciale (voir docs/facial-recognition.md)."""
    arr = np.zeros((size, size), dtype=np.uint8)
    arr[::square, :] = 255
    arr[:, ::square] = 255
    return Image.fromarray(arr, mode="L").convert("RGB")


def test_blur_variance_is_lower_for_blurred_image() -> None:
    sharp = _checkerboard()
    blurred = sharp.filter(ImageFilter.GaussianBlur(radius=6))

    sharp_variance = _blur_variance(sharp)
    blurred_variance = _blur_variance(blurred)

    assert sharp_variance is not None
    assert blurred_variance is not None
    assert blurred_variance < sharp_variance
    assert sharp_variance > BLUR_VARIANCE_THRESHOLD
    assert blurred_variance < BLUR_VARIANCE_THRESHOLD


def test_check_liveness_flags_blurry_image_but_not_sharp_image() -> None:
    sharp = _checkerboard()
    blurred = sharp.filter(ImageFilter.GaussianBlur(radius=6))

    sharp_result = check_liveness(sharp)
    blurred_result = check_liveness(blurred)

    assert "image_too_blurry" not in sharp_result.warnings
    assert "image_too_blurry" in blurred_result.warnings


def test_check_liveness_flags_low_resolution_image() -> None:
    tiny = Image.new("RGB", (MIN_WIDTH_PX - 1, MIN_HEIGHT_PX - 1), color=(120, 120, 120))

    result = check_liveness(tiny)

    assert "image_resolution_too_low" in result.warnings
    assert result.passed is False


def test_check_liveness_fails_when_no_face_detected() -> None:
    # Image synthétique nette et de résolution suffisante, mais sans visage réel :
    # doit échouer explicitement sur "no_face_detected", pas planter ni passer à tort.
    sharp = _checkerboard()

    result = check_liveness(sharp)

    assert result.passed is False
    assert "no_face_detected" in result.warnings
    # Une image nette et de taille correcte ne doit pas déclencher les deux autres
    # heuristiques de qualité — seul le critère de visage doit échouer ici.
    assert "image_too_blurry" not in result.warnings
    assert "image_resolution_too_low" not in result.warnings
