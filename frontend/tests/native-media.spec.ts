import { expect, test } from "@playwright/test"

const api = "http://localhost:8000/api/v1"
function wav() {
  const size = 24 * 8000 * 2
  const bytes = Buffer.alloc(44 + size)
  bytes.write("RIFF", 0)
  bytes.writeUInt32LE(size + 36, 4)
  bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8000, 24)
  bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(size, 40)
  bytes.writeInt16LE(Date.now() % 30000, 44)
  return bytes
}

for (const provider of ["embeddinggemma", "gemini"] as const) {
  test(`native ${provider} indexes audio and video without transcription and preserves chat`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000)
    const workspace = await (
      await page.request.post(`${api}/workspaces/`, {
        data: { name: `Native ${provider} ${Date.now()}` },
      })
    ).json()
    // Keep the initial media state under UI control even when local native auto-indexing is configured globally.
    const routing = await page.request.put(`${api}/providers/routing`, {
      data: {
        task: "embeddings",
        scope_key: `workspace:${workspace.id}`,
        provider: "gemini",
        model: "gemini-embedding-2",
      },
    })
    expect(routing.ok()).toBeTruthy()
    const conversation = await (
      await page.request.post(
        `${api}/workspaces/${workspace.id}/conversations`,
        {
          data: {
            title: "Consulta nativa",
            provider: "gemini",
            model: "gemini-2.5-flash",
          },
        },
      )
    ).json()
    const ids: string[] = []
    let documents: Record<string, any>[] = []
    const state = new Map<string, string>()
    const ready = new Set<string>()
    const requested: string[] = []
    let analyzed = 0
    let answered = false
    const version = "00000000-0000-4000-8000-000000000083"
    const index = "00000000-0000-4000-8000-000000000084"
    const model =
      provider === "gemini" ? "gemini-embedding-2" : "embeddinggemma-2-native"
    const scopes =
      provider === "gemini"
        ? ["chat", "embeddings", "multimodal_embeddings"]
        : []
    try {
      await page.route("**/api/v1/providers/", async (route) => {
        const response = await route.fetch()
        const catalog = await response.json()
        const native = (name: string, id: string) => ({
          name,
          endpoint: null,
          is_cloud: name === "gemini",
          status: "AVAILABLE",
          checked_at: new Date().toISOString(),
          models: [
            {
              id,
              provider: name,
              version: "ui-test",
              capabilities: {
                text: "unsupported",
                audio: "declared",
                video: "declared",
                embeddings: "declared",
              },
            },
          ],
        })
        const gemini = catalog.find(
          (item: { name: string }) => item.name === "gemini",
        )
        await route.fulfill({
          json: [
            ...catalog.filter(
              (item: { name: string }) =>
                !["embeddinggemma", "gemini"].includes(item.name),
            ),
            native("embeddinggemma", "embeddinggemma-2-native"),
            {
              ...native("gemini", "gemini-embedding-2"),
              models: [
                ...(gemini?.models ?? []).filter(
                  (item: { id: string }) =>
                    !item.id.startsWith("gemini-embedding-2"),
                ),
                ...native("gemini", "gemini-embedding-2").models,
              ],
            },
          ],
        })
      })
      await page.goto(`/workspaces/${workspace.id}`)
      const video = await page.evaluate(async () => {
        const canvas = document.createElement("canvas")
        canvas.width = 160
        canvas.height = 90
        const context = canvas.getContext("2d")!
        const stream = canvas.captureStream(5)
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm" })
        const chunks: Blob[] = []
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data)
        }
        const done = new Promise<Blob>((resolve) => {
          recorder.onstop = () =>
            resolve(new Blob(chunks, { type: "video/webm" }))
        })
        recorder.start()
        const timer = setInterval(() => {
          context.fillStyle = "#147a79"
          context.fillRect(0, 0, 160, 90)
          context.fillStyle = "white"
          context.fillText("Native media", 15, 45)
        }, 100)
        await new Promise((resolve) => setTimeout(resolve, 1300))
        recorder.stop()
        clearInterval(timer)
        const blob = await done
        for (const track of stream.getTracks()) track.stop()
        return Array.from(new Uint8Array(await blob.arrayBuffer()))
      })
      await page.getByTestId("workspace-pdf-upload").setInputFiles([
        {
          name: `Native-${provider}-${Date.now()}.wav`,
          mimeType: "audio/wav",
          buffer: wav(),
        },
        {
          name: `Native-${provider}-${Date.now()}.webm`,
          mimeType: "video/webm",
          buffer: Buffer.from(video),
        },
      ])
      await expect
        .poll(
          async () => {
            documents = await (
              await page.request.get(
                `${api}/workspaces/${workspace.id}/documents`,
              )
            ).json()
            for (const document of documents)
              if (!ids.includes(document.id)) ids.push(document.id)
            return (
              documents.length === 2 &&
              documents.every((document) => document.status === "MEDIA_READY")
            )
          },
          { timeout: 60000 },
        )
        .toBe(true)
      await page
        .getByRole("textbox", { name: "Pregunta sobre tus documentos" })
        .fill("Pregunta pendiente de preparar los medios")
      await expect(
        page.getByRole("button", { name: "Preguntar", exact: true }),
      ).toBeDisabled()
      await page.route(
        `**/api/v1/workspaces/${workspace.id}/documents`,
        (route) =>
          route.fulfill({
            json: documents.map((document) =>
              ready.has(document.id)
                ? {
                    ...document,
                    current_version_id: version,
                    active_index_id: index,
                    status:
                      state.get(document.id) === "RUNNING"
                        ? "NATIVE_PREPARING"
                        : "READY",
                    warning: null,
                  }
                : document,
            ),
          }),
      )
      for (const document of documents) {
        const job = () => ({
          id: `native-${document.id}`,
          kind: "native_prepare",
          state: state.get(document.id),
          stage: "native_prepare",
          progress: state.get(document.id) === "SUCCEEDED" ? 100 : 50,
          checkpoint: 1,
          error_message:
            state.get(document.id) === "FAILED"
              ? "Fallo nativo controlado"
              : null,
        })
        await page.route(`**/api/v1/documents/${document.id}/jobs`, (route) =>
          route.fulfill({ json: state.has(document.id) ? [job()] : [] }),
        )
        await page.route(
          `**/api/v1/documents/${document.id}/jobs/native-${document.id}/retry`,
          (route) => {
            state.set(document.id, "SUCCEEDED")
            ready.add(document.id)
            return route.fulfill({ json: job() })
          },
        )
        await page.route(
          `**/api/v1/documents/${document.id}/analyze`,
          (route) => {
            analyzed++
            return route.fulfill({
              status: 500,
              json: { detail: "No transcription allowed in this test" },
            })
          },
        )
        await page.route(
          `**/api/v1/documents/${document.id}/enrichment`,
          (route) => route.fulfill({ json: { questions: [], summary: null } }),
        )
        await page.route(
          `**/api/v1/documents/${document.id}/coverage`,
          (route) =>
            route.fulfill({
              json: {
                source_type: document.source_type,
                duration_seconds: document.duration_seconds,
                analysis_mode: "native_embeddings",
                segments_total: 1,
                segments_prepared: state.has(document.id) ? 1 : 0,
                segments_analyzed: 0,
                segments_indexed: ready.has(document.id) ? 1 : 0,
                temporal_precision_seconds: 10,
                processing:
                  state.has(document.id) &&
                  state.get(document.id) !== "SUCCEEDED"
                    ? job()
                    : null,
              },
            }),
        )
        await page.route(
          `**/api/v1/documents/${document.id}/segments?**`,
          (route) =>
            route.fulfill({
              json: {
                data: [
                  {
                    id: `segment-${document.id}`,
                    chunk_id: `chunk-${document.id}`,
                    source_type: document.source_type,
                    start_seconds: document.source_type === "audio" ? 10 : 0,
                    end_seconds: document.source_type === "audio" ? 20 : 1,
                    text: "",
                  },
                ],
                total: 1,
                offset: 0,
                limit: 30,
              },
            }),
        )
        await page.route(
          `**/api/v1/documents/${document.id}/prepare-native`,
          async (route) => {
            expect(route.request().postDataJSON()).toEqual({
              provider,
              model,
              dimensions: 768,
              modality: "multimodal",
            })
            const grants = await (
              await page.request.get(`${api}/documents/${document.id}/consents`)
            ).json()
            expect(
              grants
                .filter(
                  (grant: { revoked_at: string | null }) => !grant.revoked_at,
                )
                .map((grant: { scope: string }) => grant.scope)
                .sort(),
            ).toEqual(scopes)
            requested.push(document.id)
            state.set(document.id, "RUNNING")
            await route.fulfill({ json: job() })
          },
        )
      }
      const citations = documents.map((document, i) => ({
        document_id: document.id,
        document_title: document.title,
        version_id: version,
        source_type: document.source_type,
        label: i + 1,
        page_number: null,
        start_seconds: document.source_type === "audio" ? 10 : 0,
        end_seconds: document.source_type === "audio" ? 20 : 1,
        chunk_id: `chunk-${document.id}`,
        element_id: `segment-${document.id}`,
        bbox: null,
        rotation: 0,
        text: "",
      }))
      await page.route(
        `**/api/v1/conversations/${conversation.id}/messages`,
        async (route) => {
          if (route.request().method() === "POST") {
            expect(route.request().postDataJSON().document_ids.sort()).toEqual(
              [...ids].sort(),
            )
            answered = true
            await route.fulfill({
              contentType: "text/event-stream",
              body: 'event: start\ndata: {"message_id":"native-response"}\n\nevent: done\ndata: {"message_id":"native-response"}\n\n',
            })
          } else
            await route.fulfill({
              json: answered
                ? [
                    {
                      id: "native-response",
                      role: "assistant",
                      content:
                        "Evidencia nativa de ambas fuentes [Fuente 1] y [Fuente 2].",
                      state: "COMPLETE",
                      created_at: new Date().toISOString(),
                      citations,
                    },
                  ]
                : [],
            })
        },
      )
      const question = page.getByRole("textbox", {
        name: "Pregunta sobre tus documentos",
      })
      for (const document of documents) {
        await page
          .getByRole("button", {
            name: `Abrir fuente ${document.title}`,
            exact: true,
          })
          .click()
        const native = page.getByRole("region", {
          name: "Indexación multimedia nativa",
        })
        await expect(
          native.getByLabel("Modelo de embeddings multimedia nativos"),
        ).toContainText("embeddinggemma-2-native")
        await expect(
          page.getByText("Transcripción con Gemini", { exact: true }),
        ).not.toBeVisible()
        if (provider === "gemini") {
          await native
            .getByLabel("Modelo de embeddings multimedia nativos")
            .click()
          await page
            .getByRole("option", {
              name: "gemini · gemini-embedding-2",
              exact: true,
            })
            .click()
        }
        await native
          .getByRole("button", {
            name:
              provider === "gemini"
                ? "Autorizar embeddings, embeddings multimodales y chat con Gemini"
                : "Indexar nativamente en local",
            exact: true,
          })
          .click()
        await expect(
          page.getByRole("progressbar", {
            name: "Progreso de indexación multimedia nativa",
          }),
        ).toHaveAttribute("value", "50")
        await expect(
          page.getByText("0/1 segmentos indexados", { exact: true }).first(),
        ).toBeVisible({ timeout: 10000 })
        await question.fill("Borrador durante indexación nativa")
        state.set(document.id, "FAILED")
        await expect(
          page
            .getByTestId("workspace-reader")
            .getByText("Fallo nativo controlado", { exact: true }),
        ).toBeVisible({ timeout: 10000 })
        await page
          .getByRole("button", {
            name: "Reintentar procesamiento",
            exact: true,
          })
          .click()
        await expect(page.getByTestId("media-segment")).toContainText(
          "Segmento original disponible para recuperación nativa.",
        )
        await expect(question).toHaveValue("Borrador durante indexación nativa")
        await expect(
          page.getByText("1/1 segmentos indexados", { exact: true }).first(),
        ).toBeVisible({ timeout: 10000 })
      }
      expect(requested.sort()).toEqual([...ids].sort())
      expect(analyzed).toBe(0)
      await question.fill("Compara ambos medios originales con citas")
      await page.getByRole("button", { name: "Preguntar", exact: true }).click()
      await expect(page.getByTestId("chat-messages")).toContainText(
        "Evidencia nativa de ambas fuentes",
      )
      await question.fill("Borrador conservado al revisar evidencia")
      await page
        .getByRole("button", { name: /Fuente \d+.*00:10–00:20/ })
        .click()
      await expect
        .poll(() =>
          page
            .locator("audio")
            .evaluate((element) => (element as HTMLMediaElement).currentTime),
        )
        .toBeGreaterThanOrEqual(10)
      await expect(question).toHaveValue(
        "Borrador conservado al revisar evidencia",
      )
      await page
        .getByRole("region", { name: "Indexación multimedia nativa" })
        .getByRole("button", {
          name:
            provider === "gemini"
              ? "Indexar nativamente con Gemini"
              : "Indexar nativamente en local",
          exact: true,
        })
        .click()
      await expect(
        page.getByText(/Preparando segmentos nativos/).first(),
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Preguntar", exact: true }),
      ).toBeEnabled()
      await expect(question).toHaveValue(
        "Borrador conservado al revisar evidencia",
      )
      const audio = documents.find(
        (document) => document.source_type === "audio",
      )!
      state.set(audio.id, "SUCCEEDED")
      await expect(
        page.getByRole("progressbar", {
          name: "Progreso de indexación multimedia nativa",
        }),
      ).toHaveCount(0, { timeout: 10000 })
      await page
        .getByTestId("workspace-reader")
        .locator("audio")
        .evaluate((element) => element.scrollIntoView({ block: "start" }))
      await page.screenshot({
        path: testInfo.outputPath(`native-${provider}-desktop.png`),
      })
      await page
        .getByRole("button", { name: "Cerrar visor de fuente", exact: true })
        .click()
      await expect(question).toHaveValue(
        "Borrador conservado al revisar evidencia",
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await page
        .getByRole("button", { name: "Abrir visor de fuente", exact: true })
        .click()
      await expect(page.getByTestId("workspace-chat")).toBeVisible()
      await expect(
        page.getByLabel("Modelo de embeddings multimedia nativos"),
      ).toContainText(model)
      await expect
        .poll(() =>
          page
            .locator("audio")
            .evaluate((element) => (element as HTMLMediaElement).duration),
        )
        .toBeGreaterThan(23)
      await page.screenshot({
        path: testInfo.outputPath(`native-${provider}-mobile.png`),
      })
    } finally {
      test.setTimeout(testInfo.timeout + 30000)
      await page.request.delete(`${api}/workspaces/${workspace.id}`)
      for (const id of ids) await page.request.delete(`${api}/documents/${id}`)
    }
  })
}

test("RAG module records native clips, hashes and input modality without claiming transcription", async ({
  page,
}, testInfo) => {
  const documentId = "a1111111-1111-4111-8111-111111111111"
  const workspaceId = "b2222222-2222-4222-8222-222222222222"
  const messageId = "c3333333-3333-4333-8333-333333333333"
  const source = {
    id: documentId,
    title: "Fuente nativa.wav",
    source_type: "audio",
    duration_seconds: 24,
    status: "READY",
    current_version_id: "version",
    active_index_id: "index",
    page_count: 0,
  }
  const pending = {
    id: "d5555555-5555-4555-8555-555555555555",
    title: "Anexo.pdf",
  }
  const coverage = {
    source_type: "audio",
    analysis_mode: "native_embeddings",
    segments_total: 3,
    segments_prepared: 3,
    segments_analyzed: 0,
    segments_indexed: 3,
    temporal_precision_seconds: 10,
  }
  const fragment = {
    id: "chunk",
    chunk_id: "chunk",
    document_id: documentId,
    document_title: source.title,
    element_id: "element",
    source_type: "audio",
    page_number: null,
    start_seconds: 10,
    end_seconds: 20,
    text: "",
    kind: "audio_segment",
    analysis: { native_reference: true, analysis_mode: "native_embeddings" },
  }
  await page.route("**/api/v1/documents/", (route) =>
    route.fulfill({ json: [source, pending] }),
  )
  await page.route("**/api/v1/workspaces/", (route) =>
    route.fulfill({ json: [{ id: workspaceId, name: "Nativo" }] }),
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
              query: "Contenido original",
              state: "FAILED",
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
      return route.fulfill({ json: { sources: [fragment] } })
    if (path.endsWith(`/responses/${messageId}`))
      return route.fulfill({
        json: {
          workspace_id: workspaceId,
          message: {
            id: messageId,
            citations: [],
            usage: {
              trace: {
                outcome: "FAILED",
                response_mode: "buffered_native",
                transport_attempts: 2,
                indexes_pending: [pending.id],
                failure: { exception: "ReadError", http_status: 503 },
                error_code: "PROVIDER_UNAVAILABLE",
                input_modality: "native_media",
                policy: { provider: "gemini", model: "gemini-2.5-flash" },
                native_media: {
                  clips: [
                    {
                      ...fragment,
                      media: "audio",
                      source_id: 1,
                      version_id: "version",
                      clip_sha256: "abc123-native-sha256",
                      bytes: 160044,
                      mime_type: "audio/wav",
                    },
                  ],
                  omitted: 1,
                  bytes: 160044,
                  duration_seconds: 10,
                },
                extraction_coverage: [{ ...coverage, document_id: documentId }],
                stages: [
                  { stage: "native_clips_prepared", elapsed_seconds: 0.3 },
                ],
              },
            },
          },
        },
      })
    return route.continue()
  })
  await page.goto("/trace/rag")
  await page
    .getByRole("button", { name: "Inspeccionar consulta Contenido original" })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByText("Audio/video original", { exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByText("1 clip omitido por los límites de esta consulta."),
  ).toBeVisible()
  await expect(
    dialog.getByText(
      /Modo de respuesta: Audiovisual completa · Intentos de transporte: 2/,
    ),
  ).toBeVisible()
  await expect(
    dialog.getByText(
      /Búsqueda textual disponible mientras se preparan índices semánticos: Anexo.pdf/,
    ),
  ).toBeVisible()
  await expect(
    dialog.getByText(/Excepción: ReadError · HTTP: 503/),
  ).toBeVisible()
  const clips = dialog.getByRole("region", {
    name: "Segmentos nativos enviados al modelo",
  })
  await clips.locator("summary").click()
  await expect(
    clips.getByText("abc123-native-sha256", { exact: true }),
  ).toBeVisible()
  await expect(clips.getByText(/audio\/wav · 160044 bytes/)).toBeVisible()
  await dialog
    .locator("summary")
    .filter({ hasText: "Cobertura de extracción al consultar" })
    .click()
  await expect(
    dialog.getByText(
      /3\/3 segmentos preparados para embeddings nativos · 0 transcritos/,
    ),
  ).toBeVisible()
  await expect(
    dialog.getByText("Segmentos originales preparados para lectura", {
      exact: true,
    }),
  ).toBeVisible()
  await dialog
    .getByRole("button", { name: "Inspeccionar contexto RAG" })
    .click()
  await expect(
    dialog.getByText(
      "Referencia al segmento original. Recuperación mediante embeddings nativos, sin transcripción.",
    ),
  ).toBeVisible()
  await dialog
    .getByText("Referencia nativa y procedencia del segmento", { exact: true })
    .click()
  await expect(
    dialog.getByText("native_reference", { exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("native-rag-trace.png") })
  await page.keyboard.press("Escape")
  await page.getByRole("tab", { name: "Fuentes, análisis y chunks" }).click()
  await expect(
    page.getByText("00:24 · 3/3 segmentos indexados · embeddings nativos", {
      exact: true,
    }),
  ).toBeVisible()
})

test("PDF image indexing accepts native EmbeddingGemma without cloud grants", async ({
  page,
}) => {
  const workspace = await (
    await page.request.post(`${api}/workspaces/`, {
      data: { name: `Native PDF images ${Date.now()}` },
    })
  ).json()
  const documentId = "a4444444-4444-4444-8444-444444444444"
  let indexed = 0
  let grants = 0
  try {
    await page.request.post(`${api}/workspaces/${workspace.id}/conversations`, {
      data: {
        title: "PDF nativo",
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
    })
    await page.route(
      `**/api/v1/workspaces/${workspace.id}/documents`,
      (route) =>
        route.fulfill({
          json: [
            {
              id: documentId,
              title: "Figuras.pdf",
              source_type: "pdf",
              status: "EXTRACTED",
              current_version_id: "version",
              active_index_id: null,
              page_count: 1,
              warning: null,
            },
          ],
        }),
    )
    await page.route("**/api/v1/providers/routing", (route) =>
      route.fulfill({
        json: [
          {
            task: "embeddings",
            scope_key: `workspace:${workspace.id}`,
            provider: "embeddinggemma",
            model: "embeddinggemma-2-native",
          },
        ],
      }),
    )
    await page.route(`**/api/v1/documents/${documentId}/jobs`, (route) =>
      route.fulfill({ json: [] }),
    )
    await page.route(`**/api/v1/documents/${documentId}/enrichment`, (route) =>
      route.fulfill({ json: { questions: [], summary: null } }),
    )
    await page.route(`**/api/v1/documents/${documentId}/coverage`, (route) =>
      route.fulfill({
        json: {
          pages_total: 1,
          pages_extracted: 1,
          figures_total: 1,
          figures_with_chunks: 1,
          figures_multimodal_indexed: 0,
          ocr_pending_pages: [],
          visual_status: "PENDING",
        },
      }),
    )
    await page.route(`**/api/v1/documents/${documentId}/consents`, (route) => {
      if (route.request().method() === "POST") grants++
      return route.fulfill({ json: [] })
    })
    await page.route(`**/api/v1/documents/${documentId}/index`, (route) => {
      indexed++
      expect(route.request().postDataJSON()).toEqual({
        provider: "embeddinggemma",
        model: "embeddinggemma-2-native",
        dimensions: 768,
        modality: "multimodal",
      })
      return route.fulfill({ json: { id: "pdf-native-job", state: "QUEUED" } })
    })
    await page.goto(`/workspaces/${workspace.id}`)
    await page
      .getByRole("button", { name: "Fuentes y permisos", exact: true })
      .click()
    const images = page.getByRole("checkbox", {
      name: "Incluir imágenes",
      exact: true,
    })
    await expect(images).toBeEnabled()
    await expect(images).toBeChecked()
    await page
      .getByRole("button", { name: "Crear / renovar índice", exact: true })
      .click()
    await expect.poll(() => indexed).toBe(1)
    expect(grants).toBe(0)
  } finally {
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
  }
})
