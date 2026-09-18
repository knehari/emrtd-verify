import base64
import io

from fastapi import FastAPI, HTTPException
from PIL import Image

from .matcher import FaceMatcher
from .liveness import check_liveness
from .models import CompareRequest, CompareResponse

app = FastAPI(title="emrtd-verify face-match", version="0.1.0")

matcher = FaceMatcher()


def _decode_image(data_b64: str) -> Image.Image:
    try:
        return Image.open(io.BytesIO(base64.b64decode(data_b64)))
    except Exception as exc:  # noqa: BLE001 — toute image malformée doit produire une 400, pas un crash
        raise HTTPException(status_code=400, detail="Image invalide") from exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/compare", response_model=CompareResponse)
def compare(request: CompareRequest) -> CompareResponse:
    reference_image = _decode_image(request.reference_image)
    probe_image = _decode_image(request.probe_image)

    liveness = check_liveness(probe_image)
    if not liveness.passed:
        return CompareResponse(
            similarity_score=0.0,
            match_decision="inconclusive",
            liveness_passed=False,
            quality_warnings=liveness.warnings,
        )

    result = matcher.compare(reference_image, probe_image)
    return CompareResponse(
        similarity_score=result.similarity_score,
        match_decision=result.match_decision,
        liveness_passed=True,
        quality_warnings=[],
    )
