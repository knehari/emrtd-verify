"""Comparaison faciale — voir docs/facial-recognition.md.

Interface volontairement indépendante du modèle utilisé, pour permettre de brancher
un modèle open source évalué (ex. ArcFace/InsightFace) ou un service spécialisé tiers
selon les contraintes de précision/biais/hébergement du déploiement (docs/roadmap.md Phase 3).
Ne pas déployer sans audit indépendant des taux de faux positifs/négatifs par sous-groupe.
"""

from dataclasses import dataclass

from PIL import Image


@dataclass
class MatchResult:
    similarity_score: float
    match_decision: str  # "match" | "no_match" | "inconclusive"


class FaceMatcher:
    def __init__(self, match_threshold: float = 0.75, inconclusive_margin: float = 0.05):
        self.match_threshold = match_threshold
        self.inconclusive_margin = inconclusive_margin

    def compare(self, reference_image: Image.Image, probe_image: Image.Image) -> MatchResult:
        raise NotImplementedError(
            "Extraction d'embedding et comparaison faciale non implémentées — "
            "voir docs/roadmap.md Phase 3 pour le choix et l'intégration du modèle."
        )

    def _decide(self, similarity_score: float) -> str:
        if similarity_score >= self.match_threshold + self.inconclusive_margin:
            return "match"
        if similarity_score <= self.match_threshold - self.inconclusive_margin:
            return "no_match"
        return "inconclusive"
