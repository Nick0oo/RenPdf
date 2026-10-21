"""Validate model-written study material against the RAG source allowlist."""

import re
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.services.citations.validation import validate_citations
from app.services.models.contracts import ProviderError


class GeneratedStudyItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=4000)
    source_ids: list[int] = Field(min_length=1, max_length=12)

    @field_validator("question", "answer")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Empty study item")
        return value.strip()

    def cited_answer(self) -> str:
        return (
            self.answer
            + " "
            + " ".join(f"[Fuente {label}]" for label in dict.fromkeys(self.source_ids))
        )


class GeneratedStudyMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    items: list[GeneratedStudyItem] = Field(min_length=3, max_length=20)


@dataclass
class StudyGeneration:
    kind: str
    count: int
    result: GeneratedStudyMaterial | None = None

    @property
    def instruction(self) -> str:
        if self.kind == "summary":
            return (
                "\nTarea de estudio: genera un resumen claro para repasar el enfoque "
                "solicitado. Organiza conceptos e ideas clave en secciones breves, "
                "explica los términos con evidencia y cita cada apartado con "
                "[Fuente N]. No respondas sólo con una frase ni atribuyas contenido "
                "a fuentes sin respaldo. La muestra de evidencia es parcial."
            )
        return (
            "\nTarea de estudio: devuelve exclusivamente el objeto JSON del esquema, "
            "sin cercas de código. El título y las preguntas deben estar en el idioma "
            "de la consulta. Genera exactamente " + str(self.count) + " preguntas "
            "distintas, concretas y útiles para recuperar de memoria los conceptos "
            "de la evidencia. El campo question del contexto define el enfoque "
            "seleccionado: TODAS las preguntas deben tratar ese enfoque. Omite "
            "imágenes o datos ajenos al tema aunque aparezcan en las evidencias; "
            "nunca completes la cantidad pedida con temas no solicitados. Si se "
            "pide un panorama general, sí puedes cubrir distintos conceptos. "
            "Puedes variar recuerdo, comparación y aplicación; los cálculos "
            "deben identificarse como tales y citar todos sus operandos. "
            "Cada respuesta debe explicar brevemente el concepto "
            "en una o dos frases. source_ids contiene los identificadores reales "
            "que respaldan cada respuesta; el servidor añadirá sus citas. "
            "Distribuye las preguntas entre las fuentes que aportaron evidencia. "
            "No preguntes por números de página, identificadores ni etiquetas de "
            "clips. No deduzcas contenido de una referencia audiovisual sin leer "
            "el clip adjunto. Si la evidencia no basta, no inventes material. "
            "El material cubre una muestra y no todo el contenido de los archivos."
        )

    def schema(self, allowed: set[int]) -> dict | None:
        if self.kind == "summary":
            return None
        schema = GeneratedStudyMaterial.model_json_schema()
        schema["properties"]["items"].update(minItems=self.count, maxItems=self.count)
        schema["$defs"]["GeneratedStudyItem"]["properties"]["source_ids"]["items"] = {
            "type": "integer",
            "enum": sorted(allowed),
        }
        return schema

    def render(self, output: str, allowed: set[int]) -> str:
        if self.kind == "summary":
            validate_citations(output, allowed)
            return output
        try:
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", output.strip())
            result = GeneratedStudyMaterial.model_validate_json(cleaned)
            if not result.title.strip() or len(result.items) != self.count:
                raise ValueError("Invalid item count")
            questions = {
                " ".join(item.question.casefold().split()) for item in result.items
            }
            if len(questions) != self.count:
                raise ValueError("Duplicate questions")
            for item in result.items:
                if not set(item.source_ids) <= allowed:
                    raise ValueError("Unknown source")
                # Reject invented markers hidden inside the model's prose too.
                validate_citations(item.cited_answer(), set(item.source_ids))
            markdown = "\n\n".join(
                f"### {index}. {item.question}\n\n{item.cited_answer()}"
                for index, item in enumerate(result.items, 1)
            )
        except ValidationError, ValueError, ProviderError:
            raise ProviderError(
                "INVALID_STUDY_OUTPUT",
                "La IA no devolvió todas las preguntas con fuentes válidas. Reduce la cantidad o ajusta el enfoque y vuelve a generar.",
            ) from None
        self.result = result
        return f"## {result.title.strip()}\n\n{markdown}"
