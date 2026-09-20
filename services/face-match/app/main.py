import base64
import hmac
import io
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image

from .matcher import FaceMatcher
from .liveness import check_liveness
from .models import CompareRequest, CompareResponse

app = FastAPI(title="emrtd-verify face-match", version="0.1.0")

matcher = FaceMatcher()

# Généreux pour une photo DG2/capture live (quelques Mo attendus), mais borné pour empêcher un
# appelant de forcer un décodage/traitement d'image disproportionné (voir docs/threat-model.md).
MAX_ENCODED_IMAGE_CHARS = 8 * 1024 * 1024
MAX_IMAGE_DIMENSION_PX = 4096
MAX_IMAGE_PIXELS = 16_000_000


def _require_api_key(authorization: str | None = Header(default=None)) -> None:
    """`apps/api`'s FaceMatchClient envoie déjà `Authorization: Bearer FACE_MATCH_API_KEY`
    (voir apps/api/src/modules/face-match/face-match.client.ts) — cette dépendance est ce qui
    la vérifie réellement côté serveur. Échoue fermé si la clé n'est pas configurée plutôt que
    de laisser passer silencieusement une requête non authentifiée."""
    expected = os.environ.get("FACE_MATCH_API_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="FACE_MATCH_API_KEY non configurée côté service")
    presented = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else None
    if not presented or not hmac.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="Authentification invalide")


def _decode_image(data_b64: str) -> Image.Image:
    if len(data_b64) > MAX_ENCODED_IMAGE_CHARS:
        raise HTTPException(status_code=413, detail="Image trop volumineuse")
    try:
        raw = base64.b64decode(data_b64, validate=True)
        image = Image.open(io.BytesIO(raw))
        image.load()  # force le décodage maintenant, pour rejeter une image malformée ici plutôt que plus tard
    except Exception as exc:  # noqa: BLE001 — toute image malformée doit produire une 400, pas un crash
        raise HTTPException(status_code=400, detail="Image invalide") from exc
    width, height = image.size
    if width <= 0 or height <= 0 or width > MAX_IMAGE_DIMENSION_PX or height > MAX_IMAGE_DIMENSION_PX:
        raise HTTPException(status_code=400, detail="Dimensions d'image hors limites")
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=400, detail="Nombre de pixels hors limites")
    return image


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/compare", response_model=CompareResponse, dependencies=[Depends(_require_api_key)])
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
        quality_warnings=result.quality_warnings,
    )
