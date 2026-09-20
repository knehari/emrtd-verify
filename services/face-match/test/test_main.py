import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def _encode(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


SMALL_IMAGE_B64 = _encode(Image.new("RGB", (120, 120), color="white"))


def _payload(reference: str = SMALL_IMAGE_B64, probe: str = SMALL_IMAGE_B64) -> dict[str, str]:
    return {"reference_image": reference, "probe_image": probe}


def test_compare_fails_closed_when_api_key_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("FACE_MATCH_API_KEY", raising=False)
    response = client.post("/v1/compare", json=_payload())
    assert response.status_code == 503


def test_compare_rejects_missing_authorization_header(monkeypatch) -> None:
    monkeypatch.setenv("FACE_MATCH_API_KEY", "test-key")
    response = client.post("/v1/compare", json=_payload())
    assert response.status_code == 401


def test_compare_rejects_wrong_api_key(monkeypatch) -> None:
    monkeypatch.setenv("FACE_MATCH_API_KEY", "test-key")
    response = client.post(
        "/v1/compare", json=_payload(), headers={"Authorization": "Bearer wrong-key"}
    )
    assert response.status_code == 401


def test_compare_accepts_correct_api_key(monkeypatch) -> None:
    monkeypatch.setenv("FACE_MATCH_API_KEY", "test-key")
    response = client.post(
        "/v1/compare", json=_payload(), headers={"Authorization": "Bearer test-key"}
    )
    assert response.status_code == 200


def test_compare_rejects_oversized_encoded_payload(monkeypatch) -> None:
    monkeypatch.setenv("FACE_MATCH_API_KEY", "test-key")
    oversized = "A" * (8 * 1024 * 1024 + 1)
    response = client.post(
        "/v1/compare",
        json=_payload(reference=oversized),
        headers={"Authorization": "Bearer test-key"},
    )
    assert response.status_code == 413


def test_compare_rejects_image_dimension_over_limit(monkeypatch) -> None:
    monkeypatch.setenv("FACE_MATCH_API_KEY", "test-key")
    too_wide = _encode(Image.new("RGB", (4097, 100), color="white"))
    response = client.post(
        "/v1/compare",
        json=_payload(reference=too_wide),
        headers={"Authorization": "Bearer test-key"},
    )
    assert response.status_code == 400


def test_compare_rejects_pixel_count_over_limit_even_within_dimension_limit(monkeypatch) -> None:
    monkeypatch.setenv("FACE_MATCH_API_KEY", "test-key")
    # 4096x4096 respecte la limite par dimension (4096) mais dépasse MAX_IMAGE_PIXELS (16 000 000).
    huge_pixel_count = _encode(Image.new("RGB", (4096, 4096), color="white"))
    response = client.post(
        "/v1/compare",
        json=_payload(reference=huge_pixel_count),
        headers={"Authorization": "Bearer test-key"},
    )
    assert response.status_code == 400
