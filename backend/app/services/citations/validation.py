import re

from app.services.models.contracts import ProviderError

SOURCE_PATTERN = re.compile(
    r"\[\s*(?:(?:Fuente|Source|S)\s*)?\d+(?:\s*[,;]\s*(?:(?:Fuente|Source|S)\s*)?\d+)*\s*\]",
    re.IGNORECASE,
)
ABSTENTION = "No encontré información suficiente en las evidencias recuperadas para responder esta pregunta."


def validate_citations(answer: str, allowed: set[int]) -> set[int]:
    if answer.strip() == ABSTENTION:
        return set()
    markers = re.findall(r"\[(?:Fuente|Source)\b[^\]]*\]", answer, re.IGNORECASE)
    if any(not SOURCE_PATTERN.fullmatch(marker) for marker in markers):
        raise ProviderError(
            "INVALID_CITATIONS", "El modelo produjo una referencia mal formada."
        )
    cited = {
        int(value)
        for marker in SOURCE_PATTERN.findall(answer)
        for value in re.findall(r"\d+", marker)
    }
    if cited - allowed:
        raise ProviderError(
            "INVALID_CITATIONS",
            "El modelo produjo referencias inexistentes. La respuesta no fue validada.",
        )
    if allowed and not cited:
        raise ProviderError(
            "MISSING_CITATIONS", "El modelo respondió sin referencias verificables."
        )
    return cited


def canonicalize_citations(answer: str) -> str:
    return SOURCE_PATTERN.sub(
        lambda match: " ".join(
            f"[Fuente {int(value)}]" for value in re.findall(r"\d+", match.group())
        ),
        answer,
    )
