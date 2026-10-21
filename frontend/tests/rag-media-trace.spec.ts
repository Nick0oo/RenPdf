import { expect, test } from "@playwright/test"

const documentId = "a1111111-1111-4111-8111-111111111111"
const workspaceId = "b2222222-2222-4222-8222-222222222222"
const messageId = "c3333333-3333-4333-8333-333333333333"
const source = {
  id: documentId,
  title: "Reunión Aurora.wav",
  source_type: "audio",
  mime_type: "audio/wav",
  duration_seconds: 22,
  page_count: 0,
  file_size: 352044,
  original_filename: "Aurora.wav",
  current_version_id: "version",
  active_index_id: "index",
  status: "READY",
  warning: null,
}
const coverage = {
  source_type: "audio",
  duration_seconds: 22,
  segments_analyzed: 3,
  segments_total: 3,
  segments_indexed: 3,
  analysis_status: "ANALYZED",
  analysis_provider: "gemini",
  analysis_model: "gemini-test",
  temporal_precision_seconds: 10,
  index_modality: "text",
}
const fragment = {
  id: "chunk",
  chunk_id: "chunk",
  document_id: documentId,
  document_title: source.title,
  source_type: "audio",
  page_number: null,
  start_seconds: 10,
  end_seconds: 20,
  text: "Aurora tiene un presupuesto de 731 pesos.",
  kind: "audio_segment",
  analysis: {
    provider: "gemini",
    model: "gemini-test",
    temporal_precision: "segment_boundary",
  },
}

test("Excel RAG module exposes worksheet filters, cell provenance and viewer links", async ({
  page,
}) => {
  const book = {
    ...source,
    title: "Presupuesto.xlsx",
    source_type: "spreadsheet",
    sheet_count: 2,
    mime_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
  const cell = {
    ...fragment,
    source_type: "spreadsheet",
    document_title: book.title,
    start_seconds: null,
    end_seconds: null,
    sheet_name: "Fórmulas",
    cell_range: "B3",
    text: "Hoja Fórmulas · B3: fórmula sin resultado guardado",
    kind: "spreadsheet_cell",
    analysis: { formula: "=B2*10", cached: false, value: null },
  }
  await page.route("**/api/v1/trace/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/rag/sources"))
      return route.fulfill({
        json: {
          total: 1,
          data: [
            {
              document: book,
              coverage: {
                source_type: "spreadsheet",
                sheets_total: 2,
                sheets_extracted: 2,
                cells_total: 7,
                cells_with_chunks: 7,
                formula_cells: 2,
                formulas_without_cached_values: 1,
              },
              chunks: 3,
              workspace_ids: [workspaceId],
            },
          ],
        },
      })
    if (path.endsWith(`/documents/${documentId}`))
      return route.fulfill({
        json: {
          document: book,
          sha256: "synthetic",
          jobs: [],
          lineage: [],
          lineage_total: 0,
          versions: [
            {
              id: "version",
              number: 1,
              state: "EXTRACTED",
              parser: "openpyxl",
              parser_version: "spreadsheet-v1",
              extraction: {
                sheets_total: 2,
                cells_total: 7,
                formula_cells: 2,
                formulas_without_cached_values: 1,
              },
              current: true,
              chunks: 3,
              figures: 0,
              indexes: [],
              created_at: new Date().toISOString(),
            },
          ],
        },
      })
    if (path.endsWith("/chunks"))
      return route.fulfill({ json: { total: 1, data: [cell] } })
    return route.fallback()
  })
  await page.goto("/trace/rag")
  await page.getByRole("tab", { name: "Fuentes, análisis y chunks" }).click()
  await page
    .getByRole("button", { name: `Inspeccionar fuente ${book.title}` })
    .click()
  const dialog = page.getByRole("dialog")
  await dialog
    .getByRole("button", { name: "Explorar chunks del documento" })
    .click()
  const filtered = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return (
      url.pathname.endsWith("/chunks") &&
      url.searchParams.get("sheet") === "Fórmulas" &&
      url.searchParams.get("cell") === "B3"
    )
  })
  await dialog.getByLabel("Filtrar chunks por hoja").fill("Fórmulas")
  await dialog.getByLabel("Filtrar celdas por referencia").fill("B3")
  await filtered
  await expect(dialog.getByText(cell.text, { exact: true })).toBeVisible()
  const link = dialog.getByRole("article").getByRole("link", {
    name: "Abrir fuente en el workspace",
  })
  await expect(link).toHaveAttribute("href", /sheet=.*F.*rmulas.*cell=B3/)
  await dialog.getByText("Valor, fórmula y procedencia de la celda").click()
  await expect(dialog.getByText("=B2*10", { exact: true })).toBeVisible()
  await expect(dialog.getByText("false", { exact: true })).toBeVisible()
  await dialog.getByLabel("Filtrar celdas por referencia").fill("inválida")
  await expect(dialog.getByRole("alert")).toContainText("B2 o B2:C8")
})

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/workspaces/", (route) =>
    route.fulfill({ json: [{ id: workspaceId, name: "Aurora" }] }),
  )
  await page.route("**/api/v1/documents/", (route) =>
    route.fulfill({ json: [source] }),
  )
  await page.route(`**/api/v1/documents/${documentId}/coverage`, (route) =>
    route.fulfill({ json: coverage }),
  )
  await page.route("**/api/v1/trace/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/rag/queries"))
      return route.fulfill({
        json: {
          total: 1,
          data: [
            {
              id: messageId,
              query: "¿Qué presupuesto tiene Aurora?",
              title: "Comparación temporal",
              state: "COMPLETE",
              model: "gemini-test",
              retrieval_mode: "hybrid",
              workspace_id: workspaceId,
              created_at: new Date().toISOString(),
            },
          ],
        },
      })
    if (path.endsWith("/rag/sources"))
      return route.fulfill({
        json: {
          total: 1,
          data: [
            {
              document: source,
              coverage,
              chunks: 3,
              workspace_ids: [workspaceId],
            },
          ],
        },
      })
    if (path.endsWith("/context"))
      return route.fulfill({
        json: {
          query: "¿Qué presupuesto tiene Aurora?",
          sources: [{ ...fragment, label: 1 }],
        },
      })
    if (path.endsWith("/chunks"))
      return route.fulfill({ json: { total: 1, data: [fragment] } })
    if (path.endsWith(`/responses/${messageId}`))
      return route.fulfill({
        json: {
          workspace_id: workspaceId,
          message: {
            id: messageId,
            citations: [],
            usage: {
              trace: {
                outcome: "COMPLETE",
                elapsed_seconds: 1.25,
                sources: [{ ...fragment, label: 1, chars: 40 }],
                retrieval: {
                  strategy: "hybrid",
                  ranking: [
                    { chunk_id: "chunk", rank: 1, score: 0.02, selected: true },
                  ],
                },
                extraction_coverage: [coverage],
              },
            },
          },
        },
      })
    if (path.endsWith(`/documents/${documentId}`))
      return route.fulfill({
        json: {
          document: source,
          sha256: "synthetic",
          jobs: [],
          lineage: [],
          lineage_total: 0,
          versions: [
            {
              id: "version",
              number: 1,
              state: "EXTRACTED",
              parser: "ffmpeg-gemini-segments",
              parser_version: "temporal-v1",
              extraction: {
                analysis_provider: "gemini",
                analysis_model: "gemini-test",
                segments_analyzed: 3,
                segments_total: 3,
                segment_seconds: 10,
              },
              current: true,
              chunks: 3,
              figures: 0,
              indexes: [],
              created_at: new Date().toISOString(),
            },
          ],
        },
      })
    return route.continue()
  })
})

test("RAG module exposes query execution and its temporal context", async ({
  page,
}) => {
  await page.goto("/trace/rag")
  await expect(
    page.getByRole("heading", { name: "RAG y segmentos" }),
  ).toBeVisible()
  await page
    .getByRole("button", {
      name: "Inspeccionar consulta ¿Qué presupuesto tiene Aurora?",
    })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("00:10–00:20", { exact: false })).toBeVisible()
  await dialog
    .getByRole("button", { name: "Inspeccionar contexto RAG" })
    .click()
  await expect(dialog.getByText(fragment.text, { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole("link", { name: "Abrir fuente en el workspace" }),
  ).toHaveAttribute("href", new RegExp(`document=${documentId}.*time=10`))
})

test("RAG source analysis exposes timestamp filters, provenance and source links", async ({
  page,
}, testInfo) => {
  await page.goto("/trace/rag")
  await page.getByRole("tab", { name: "Fuentes, análisis y chunks" }).click()
  await page
    .getByRole("button", { name: `Inspeccionar fuente ${source.title}` })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText(/Análisis: gemini · gemini-test/)).toBeVisible()
  await dialog
    .getByRole("button", { name: "Explorar chunks del documento" })
    .click()
  const filtered = page.waitForRequest(
    (request) =>
      request.url().includes("/chunks?") &&
      new URL(request.url()).searchParams.get("second") === "12",
  )
  await dialog.getByLabel("Filtrar segmentos por segundo").fill("12")
  await filtered
  await expect(dialog.getByText("00:10–00:20", { exact: false })).toBeVisible()
  await dialog.getByText("Análisis y procedencia del segmento").click()
  await expect(
    dialog.getByText("segment_boundary", { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("rag-audio-provenance.png"),
  })
})
