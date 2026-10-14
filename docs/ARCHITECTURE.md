# Arquitectura

RenPdf conserva la base `372dbcb` del [template oficial](https://github.com/fastapi/full-stack-fastapi-template)
y la adaptación local `1c32e668065d7e5490263d90e75eb4b7cdb9fcba`. Monolito modular
FastAPI/SQLModel, React/TypeScript/Vite/TanStack Router y Query, Tailwind/shadcn.
Celery separa el trabajo documental de HTTP; PostgreSQL es la fuente de verdad.

```mermaid
flowchart LR
    UI[React + visor PDF.js] --> API[FastAPI + autenticación]
    API --> DB[(PostgreSQL + pgvector)]
    API --> FS[Originales y miniaturas persistentes]
    API --> R[Redis / broker]
    R --> W[Celery: un worker]
    W --> DB
    W --> FS
    W --> P[Docling / PyMuPDF / Tesseract]
    W --> AI[Adaptadores de modelos]
    API --> AI
    C[Consentimiento por documento y propósito] --> AI
```

Servicios obligatorios: PostgreSQL+vector, Redis, API, worker y almacenamiento.
El scheduler recupera trabajos aceptados que aún no llegaron al broker y trabajos
interrumpidos; no almacena su resultado como fuente de verdad. Los originales
se montan en `./storage`; el worker y la API comparten la misma raíz.

Proveedores reales: Gemini (`google-genai`), Ollama nativo, llama.cpp y OpenAI
compatible (HTTPX). Descubrimiento no envía documentos ni carga modelos.
Una capacidad declarada no se presenta como comprobada mediante inferencia.
Cloud se autoriza por documento/proveedor/alcance, sin fallback implícito.

Docling es el parser estructural preferido cuando se instala el extra y se
configuran artefactos locales. El modo `auto` utiliza PyMuPDF si faltan estos
recursos y lo informa. No hay importación de Torch en la ruta ligera. No se
instalan ni descargan pesos automáticamente.

Frontend: biblioteca, workspaces, visor de una página a la vez, chat SSE,
fuentes, consentimiento, notas, marcadores, selección de modelos y diagnósticos.
El módulo de investigación se carga al abrir un workspace. El cliente se genera
desde OpenAPI, con DTOs públicos separados de secretos y claves de almacenamiento.
