from typing import Literal

from pydantic import BaseModel, Field

MatchDecision = Literal["match", "no_match", "inconclusive"]


class CompareRequest(BaseModel):
    # Images encodées en base64 : reference = photo DG2 extraite de la puce,
    # probe = capture vivante. Voir docs/facial-recognition.md.
    reference_image: str
    probe_image: str


class CompareResponse(BaseModel):
    similarity_score: float = Field(ge=0.0, le=1.0)
    match_decision: MatchDecision
    liveness_passed: bool
    quality_warnings: list[str]
