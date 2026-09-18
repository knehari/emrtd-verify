import pytest

from app.matcher import FaceMatcher


def test_decide_match_above_threshold() -> None:
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    assert matcher._decide(0.95) == "match"


def test_decide_no_match_below_threshold() -> None:
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    assert matcher._decide(0.3) == "no_match"


def test_decide_inconclusive_near_threshold() -> None:
    matcher = FaceMatcher(match_threshold=0.75, inconclusive_margin=0.05)
    assert matcher._decide(0.75) == "inconclusive"


def test_compare_not_yet_implemented() -> None:
    matcher = FaceMatcher()
    with pytest.raises(NotImplementedError):
        matcher.compare(None, None)  # type: ignore[arg-type]
