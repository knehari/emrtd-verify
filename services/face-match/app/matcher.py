"""Comparaison faciale — voir docs/facial-recognition.md.

Implémentation réelle : détection (YuNet) + embedding (SFace) via `app/face_engine.py`,
tous deux exécutés localement (aucun appel réseau, aucune donnée envoyée à un tiers).
La logique de détection/embedding est isolée dans `face_engine.py` et celle de
similarité/décision est composée de fonctions pures ci-dessous, pour rester testable
sans charger les modèles (voir test/test_matcher.py).

Le seuil `match_threshold` par défaut est une valeur de départ raisonnable, **pas**
une valeur calibrée sur un jeu de données de production : voir la note de calibration
plus bas et docs/facial-recognition.md. Ne pas déployer sans audit indépendant des
taux de faux positifs/négatifs par sous-groupe démographique.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from .face_engine import get_face_engine


@dataclass
class MatchResult:
    similarity_score: float
    match_decision: str  # "match" | "no_match" | "inconclusive"
    quality_warnings: list[str] = field(default_factory=list)


class FaceMatcher:
    def __init__(self, match_threshold: float = 0.75, inconclusive_margin: float = 0.05):
        self.match_threshold = match_threshold
        self.inconclusive_margin = inconclusive_margin

    def compare(self, reference_image: Image.Image, probe_image: Image.Image) -> MatchResult:
        engine = get_face_engine()

        reference_faces = engine.detect_faces(reference_image)
        probe_faces = engine.detect_faces(probe_image)

        warnings: list[str] = []
        if not reference_faces:
            warnings.append("no_face_detected_in_reference_image")
        elif len(reference_faces) > 1:
            warnings.append("multiple_faces_detected_in_reference_image")
        if not probe_faces:
            warnings.append("no_face_detected_in_probe_image")
        elif len(probe_faces) > 1:
            warnings.append("multiple_faces_detected_in_probe_image")

        if not reference_faces or not probe_faces:
            # Pas de visage exploitable des deux côtés : impossible de calculer une
            # similarité fiable. On ne devine pas — "inconclusive" plutôt qu'un score
            # arbitraire, pour ne jamais produire un faux "no_match" ou "match".
            return MatchResult(similarity_score=0.0, match_decision="inconclusive", quality_warnings=warnings)

        # Si plusieurs visages sont détectés dans une image, on retient celui dont la
        # détection est la plus confiante (voir avertissement "multiple_faces_detected_*").
        reference_face = max(reference_faces, key=lambda f: f.confidence)
        probe_face = max(probe_faces, key=lambda f: f.confidence)

        raw_cosine = self._cosine_similarity(reference_face.embedding, probe_face.embedding)
        similarity_score = self._normalize_similarity(raw_cosine)
        decision = self._decide(similarity_score)
        return MatchResult(similarity_score=similarity_score, match_decision=decision, quality_warnings=warnings)

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Similarité cosinus pure entre deux embeddings — fonction indépendante du
        modèle, testable directement avec des vecteurs synthétiques."""
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        if denom == 0.0:
            return 0.0
        return float(np.dot(a, b) / denom)

    @staticmethod
    def _normalize_similarity(cosine_similarity: float) -> float:
        """Ramène une similarité cosinus (dans [-1, 1]) vers [0, 1], comme l'exige
        `CompareResponse.similarity_score`.

        Note de calibration : les embeddings SFace produisent, pour une paire
        "même personne" bien détectée, une similarité cosinus brute typiquement
        > 0.36 (seuil de référence publié par OpenCV Zoo pour SFace) et souvent
        > 0.9 pour deux captures propres de la même personne. `match_threshold`
        (dans l'espace normalisé [0, 1] utilisé par `_decide`) doit être calibré
        sur un jeu de données représentatif du déploiement réel, pas déduit de ce
        seul commentaire — voir docs/facial-recognition.md.
        """
        return float(min(1.0, max(0.0, (cosine_similarity + 1.0) / 2.0)))

    def _decide(self, similarity_score: float) -> str:
        if similarity_score >= self.match_threshold + self.inconclusive_margin:
            return "match"
        if similarity_score <= self.match_threshold - self.inconclusive_margin:
            return "no_match"
        return "inconclusive"
