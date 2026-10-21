"""Known input restrictions, without inferring audio support from text chat."""

from typing import Literal

from app.services.models.contracts import ProviderError


def audio_input_capability(model: str) -> Literal["declared", "unknown", "unsupported"]:
    identifier = model.lower().removeprefix("models/")
    # Google Gemma 4 model card: the large 26B/31B variants lack audio inputs.
    # Do not extrapolate this restriction to other families such as Gemma 3n.
    if identifier.startswith(("gemma-4-e2b", "gemma-4-e4b", "gemma-4-12b")):
        return "declared"
    if identifier.startswith(
        ("gemma-4-31b", "gemma-4-26b", "gemma-3-", "gemma-2-", "gemma-1-")
    ):
        return "unsupported"
    return "unknown"


def validate_media_analysis_model(model: str) -> None:
    if audio_input_capability(model) == "unsupported":
        raise ProviderError(
            "MEDIA_MODEL_UNSUPPORTED",
            f"{model} no admite entrada de audio para este análisis. Selecciona un modelo Gemini compatible, como Gemini Flash.",
        )
