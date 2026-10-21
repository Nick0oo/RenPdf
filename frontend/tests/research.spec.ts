import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const api = "http://localhost:8000/api/v1"
const fixture = (name: string) =>
  fs.readFileSync(path.resolve(`../backend/tests/fixtures/${name}`))

test("library opens a direct workspace chat, preserves it and shows a focused PDF", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000)
  const upload = await page.request.post(`${api}/documents/`, {
    multipart: {
      file: {
        name: `Entry-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fixture("digital_es.pdf"),
          Buffer.from(`\n% shell ${Date.now()}`),
        ]),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const document = await upload.json()
  let workspaceId = ""
  try {
    await page.goto("/library")
    const workspaceResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/workspaces/"),
    )
    await page
      .getByRole("button", {
        name: `Chatear con ${document.title}`,
        exact: true,
      })
      .click()
    workspaceId = (await (await workspaceResponse).json()).id
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}`))
    await expect(page.getByTestId("workspace-reader")).toHaveCount(0)
    await expect(page.getByTestId("workspace-chat")).toBeVisible()
    await page
      .getByRole("button", { name: "Abrir visor de fuente", exact: true })
      .click()
    await expect(page.locator("[data-testid=pdf-page] canvas")).toBeVisible()
    await expect(page.getByTestId("workspace-reader")).toBeVisible()
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                `${api}/workspaces/${workspaceId}/conversations`,
              )
            ).json()
          ).length,
      )
      .toBe(1)
    await page.goto("/library")
    await page
      .getByRole("button", {
        name: `Chatear con ${document.title}`,
        exact: true,
      })
      .click()
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toBeVisible()
    expect(
      (
        await (
          await page.request.get(
            `${api}/workspaces/${workspaceId}/conversations`,
          )
        ).json()
      ).length,
    ).toBe(1)
    await page
      .getByRole("button", { name: "Nueva conversación", exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                `${api}/workspaces/${workspaceId}/conversations`,
              )
            ).json()
          ).length,
      )
      .toBe(2)
    await page.getByLabel("Modelo de conversación").click()
    await page
      .getByRole("combobox", { name: "Buscar en Modelo de conversación" })
      .fill("gemini-2.5-flash")
    await page
      .getByRole("option", { name: "gemini · gemini-2.5-flash", exact: true })
      .click()
    await expect(page.getByLabel("Modelo de conversación")).toContainText(
      "gemini-2.5-flash",
    )
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
    await page.reload()
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("workspace-desktop.png"),
      fullPage: false,
    })
    await page
      .getByRole("button", { name: "Cerrar visor de fuente", exact: true })
      .click()
    await expect(page.getByTestId("workspace-reader")).toHaveCount(0)
    await page
      .getByRole("button", { name: "Abrir visor de fuente", exact: true })
      .click()
    await expect(page.locator("[data-testid=pdf-page] canvas")).toBeVisible({
      timeout: 30000,
    })
    await page.screenshot({
      path: testInfo.outputPath("pdf-focus-desktop.png"),
      fullPage: false,
    })
    await page.keyboard.press("Escape")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Preguntar", exact: true }),
    ).toBeInViewport()
    await page.screenshot({
      path: testInfo.outputPath("workspace-mobile.png"),
      fullPage: false,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    test.setTimeout(testInfo.timeout + 30000)
    if (workspaceId)
      await page.request.delete(`${api}/workspaces/${workspaceId}`)
    await page.request.delete(`${api}/documents/${document.id}`)
  }
})

test("workspace accepts multiple PDFs, prominent notes and real scoped settings", async ({
  page,
}, testInfo) => {
  test.setTimeout(150000)
  const response = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Workspace sintético ${Date.now()}` },
  })
  expect(response.ok()).toBeTruthy()
  const workspace = await response.json()
  const createdIds: string[] = []
  try {
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId("workspace-pdf-upload").setInputFiles([
      {
        name: `ES-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fixture("digital_es.pdf"),
          Buffer.from(`\n% multi ES ${Date.now()}`),
        ]),
      },
      {
        name: `EN-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fixture("english_conflict.pdf"),
          Buffer.from(`\n% multi EN ${Date.now()}`),
        ]),
      },
    ])
    await expect
      .poll(
        async () => {
          const documents = await (
            await page.request.get(
              `${api}/workspaces/${workspace.id}/documents`,
            )
          ).json()
          for (const document of documents)
            if (!createdIds.includes(document.id)) createdIds.push(document.id)
          return documents.length
        },
        { timeout: 45000 },
      )
      .toBe(2)
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                `${api}/workspaces/${workspace.id}/documents`,
              )
            ).json()
          ).every(
            (document: { current_version_id: string | null }) =>
              !!document.current_version_id,
          ),
        { timeout: 60000 },
      )
      .toBe(true)
    await expect(page.getByText("2 de 2 fuentes activas")).toBeVisible()
    await page
      .getByRole("checkbox", { name: /^Consultar / })
      .first()
      .uncheck()
    await expect(page.getByText("1 de 2 fuentes activas")).toBeVisible()
    await page.reload()
    await expect(page.getByText("1 de 2 fuentes activas")).toBeVisible()
    await page
      .getByRole("button", { name: "Consultar todas", exact: true })
      .click()
    await expect(page.getByText("2 de 2 fuentes activas")).toBeVisible()
    await page
      .locator("summary")
      .filter({ hasText: /^Notas/ })
      .click()
    await page
      .getByRole("textbox", { name: "Nota personal", exact: true })
      .fill("Una idea persistida junto a sus fuentes")
    await page
      .getByRole("button", { name: "Guardar nota", exact: true })
      .click()
    await expect(
      page.getByRole("button", {
        name: "Una idea persistida junto a sus fuentes",
        exact: true,
      }),
    ).toBeVisible()
    await page.reload()
    await page
      .locator("summary")
      .filter({ hasText: /^Notas/ })
      .click()
    await expect(
      page.getByRole("button", {
        name: "Una idea persistida junto a sus fuentes",
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Configuración del workspace" })
      .click()
    await page
      .getByLabel("Nombre del workspace")
      .fill(`Investigación editada ${Date.now()}`)
    await page
      .getByLabel("Propósito de la investigación")
      .fill("Comparar dos documentos sintéticos y sus conclusiones.")
    await page
      .getByRole("button", { name: "Guardar workspace", exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${api}/workspaces/`)).json()).find(
            (item: { id: string }) => item.id === workspace.id,
          )?.description,
      )
      .toBe("Comparar dos documentos sintéticos y sus conclusiones.")
    await expect(
      page.getByRole("heading", {
        name: "Modelos de este workspace",
        exact: true,
      }),
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath("workspace-notes.png"),
      fullPage: false,
    })
  } finally {
    test.setTimeout(testInfo.timeout + 30000)
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
    for (const id of createdIds)
      await page.request.delete(`${api}/documents/${id}`)
  }
})

test("workspace privacy rejects cloud before explicit grants, then citations open the reader", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  const upload = await page.request.post(`${api}/documents/`, {
    multipart: {
      file: {
        name: `Citations-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fixture("digital_es.pdf"),
          Buffer.from(`\n% citations ${Date.now()}`),
        ]),
      },
    },
  })
  const document = await upload.json()
  const workspace = await (
    await page.request.post(`${api}/workspaces/`, {
      data: { name: `Fuentes citadas ${Date.now()}` },
    })
  ).json()
  try {
    const attached = await page.request.put(
      `${api}/workspaces/${workspace.id}/documents/${document.id}`,
    )
    expect(attached.ok()).toBeTruthy()
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`${api}/documents/${document.id}`)
            ).json()
          ).current_version_id,
        { timeout: 60000 },
      )
      .toBeTruthy()
    if (process.env.RUN_CLOUD_E2E !== "1") {
      // This fixture tests the real consent rejection independently of vector processing.
      const jobs = await (
        await page.request.get(`${api}/documents/${document.id}/jobs`)
      ).json()
      for (const job of jobs.filter(
        (item: { kind: string; state: string }) =>
          item.kind === "index" && ["QUEUED", "RUNNING"].includes(item.state),
      ))
        await page.request.post(
          `${api}/documents/${document.id}/jobs/${job.id}/cancel`,
        )
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`${api}/documents/${document.id}`)
              ).json()
            ).status,
          { timeout: 30000 },
        )
        .not.toBe("INDEXING")
    }
    await page.goto(`/workspaces/${workspace.id}?start=true`)
    await page.getByLabel("Modelo de conversación").click()
    await page
      .getByRole("combobox", { name: "Buscar en Modelo de conversación" })
      .fill("gemini-2.5-flash")
    await page
      .getByRole("option", { name: "gemini · gemini-2.5-flash", exact: true })
      .click()
    await page
      .getByRole("textbox", { name: "Pregunta sobre tus documentos" })
      .fill("capacidad solar instalada")
    await page.getByRole("button", { name: "Preguntar", exact: true }).click()
    await expect(page.getByTestId("chat-messages")).toContainText("Autoriza", {
      timeout: 30000,
    })
    await expect(
      page.getByRole("dialog", { name: "Fuentes y permisos" }),
    ).toBeVisible()
    await expect(
      page.getByRole("tab", { name: "Privacidad", exact: true }),
    ).toHaveAttribute("data-state", "active")
    await expect(page.getByText("Autorizar envíos a gemini")).toBeVisible()
    expect(
      await (
        await page.request.get(`${api}/documents/${document.id}/consents`)
      ).json(),
    ).toEqual([])
    await page.keyboard.press("Escape")
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toHaveValue("capacidad solar instalada")
    if (process.env.RUN_CLOUD_E2E === "1") {
      await page.request.post(`${api}/documents/${document.id}/consents`, {
        data: { provider: "gemini", scope: "chat", expires_in_days: 1 },
      })
      await page
        .getByRole("textbox", { name: "Pregunta sobre tus documentos" })
        .fill("capacidad solar instalada")
      await page.getByRole("button", { name: "Preguntar", exact: true }).click()
      await expect(page.getByTestId("chat-messages")).toContainText("120", {
        timeout: 60000,
      })
      await page
        .getByRole("button", { name: /Fuente \d+.*p\. 1/ })
        .last()
        .click()
      await expect(page.getByTestId("citation-highlight")).toBeVisible()
      const initial = await page.getByTestId("citation-highlight").boundingBox()
      await page.getByRole("button", { name: "Aumentar zoom" }).click()
      await expect
        .poll(
          async () =>
            (await page.getByTestId("citation-highlight").boundingBox())?.width,
        )
        .toBeGreaterThan(initial?.width ?? 0)
      await page.getByRole("button", { name: "Rotar PDF" }).click()
      await expect(page.getByTestId("citation-highlight")).toBeVisible()
      await page.keyboard.press("Escape")
      await page.screenshot({
        path: testInfo.outputPath("chat-cited-desktop.png"),
        fullPage: false,
      })
    }
  } finally {
    test.setTimeout(testInfo.timeout + 30000)
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
    await page.request.delete(`${api}/documents/${document.id}`)
  }
})

test("account and configuration expose real settings in the hierarchical shell", async ({
  page,
}) => {
  await page.goto("/settings")
  await expect(
    page.getByRole("heading", { name: "Tu cuenta", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Editar perfil", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Actualizar contraseña", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Oscuro", exact: true }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.getByRole("button", { name: "Claro", exact: true }).click()
  await page.getByRole("link", { name: "Configuración", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Configuración", exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel("Modelo para Conversación")).toBeVisible()
  await page.getByRole("tab", { name: "Conexiones", exact: true }).click()
  await expect(page.getByText("llamacpp", { exact: true })).toBeVisible()
})

function silentWav(seconds: number) {
  const sampleRate = 8000
  const size = seconds * sampleRate * 2
  const data = Buffer.alloc(44 + size)
  data.write("RIFF", 0)
  data.writeUInt32LE(36 + size, 4)
  data.write("WAVEfmt ", 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sampleRate, 24)
  data.writeUInt32LE(sampleRate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write("data", 36)
  data.writeUInt32LE(size, 40)
  data.writeInt16LE(Date.now() % 30000, 44)
  return data
}

test("workspace uploads audio and video, requests explicit analysis and seeks temporal citations without losing the draft", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  const workspaceResponse = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Fuentes temporales ${Date.now()}` },
  })
  expect(workspaceResponse.ok()).toBeTruthy()
  const workspace = await workspaceResponse.json()
  const createdIds: string[] = []
  const analyzed = new Set<string>()
  const analysisStates = new Map<string, string>()
  let completed = false
  let documents: Record<string, any>[] = []
  let citations: Record<string, unknown>[] = []
  const conversation = await (
    await page.request.post(`${api}/workspaces/${workspace.id}/conversations`, {
      data: {
        title: "Audio y video con citas",
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
    })
  ).json()
  try {
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
        context.fillText("Prueba de video", 15, 45)
      }, 100)
      await new Promise((resolve) => setTimeout(resolve, 1400))
      recorder.stop()
      clearInterval(timer)
      const blob = await done
      for (const track of stream.getTracks()) track.stop()
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    const token = Date.now()
    await page.getByTestId("workspace-pdf-upload").setInputFiles([
      {
        name: `Audio-${token}.wav`,
        mimeType: "audio/wav",
        buffer: silentWav(40),
      },
      {
        name: `Video-${token}.webm`,
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
            if (!createdIds.includes(document.id)) createdIds.push(document.id)
          return (
            documents.length === 2 &&
            documents.every((document) => document.status === "MEDIA_READY")
          )
        },
        { timeout: 60000 },
      )
      .toBe(true)
    const audio = documents.find(
      (document) => document.source_type === "audio",
    )!
    const movie = documents.find(
      (document) => document.source_type === "video",
    )!
    expect(audio.duration_seconds).toBeGreaterThan(39)
    expect(movie.duration_seconds).toBeGreaterThan(1)
    await expect(page.getByTestId("workspace-reader")).toHaveCount(0)
    const version = "00000000-0000-4000-8000-000000000093"
    citations = documents.map((document, index) => ({
      document_id: document.id,
      document_title: document.title,
      version_id: version,
      source_type: document.source_type,
      label: index + 1,
      page_number: null,
      start_seconds: document.source_type === "audio" ? 10 : 0,
      end_seconds: document.source_type === "audio" ? 20 : 1,
      chunk_id: `chunk-${index}`,
      element_id: `element-${index}`,
      bbox: null,
      rotation: 0,
      text:
        document.source_type === "audio"
          ? "Evidencia de audio controlada"
          : "Evidencia visual controlada",
    }))
    await page.route(
      `**/api/v1/workspaces/${workspace.id}/documents`,
      (route) =>
        route.fulfill({
          json: documents.map((document) =>
            analyzed.has(document.id)
              ? {
                  ...document,
                  current_version_id: version,
                  status: "EXTRACTED",
                  warning: null,
                }
              : document,
          ),
        }),
    )
    for (const document of documents) {
      await page.route(`**/api/v1/documents/${document.id}/jobs`, (route) =>
        route.fulfill({
          json: analysisStates.has(document.id)
            ? [
                {
                  id: `analysis-${document.id}`,
                  kind: "media_analysis",
                  state: analysisStates.get(document.id),
                  stage: "media_analysis",
                  progress: 50,
                  checkpoint: 1,
                  error_message:
                    analysisStates.get(document.id) === "FAILED"
                      ? "Error controlado de análisis"
                      : null,
                },
              ]
            : [],
        }),
      )
      await page.route(
        `**/api/v1/documents/${document.id}/jobs/analysis-${document.id}/retry`,
        async (route) => {
          analysisStates.set(document.id, "SUCCEEDED")
          analyzed.add(document.id)
          await route.fulfill({
            json: { id: `analysis-${document.id}`, state: "SUCCEEDED" },
          })
        },
      )
      await page.route(
        `**/api/v1/documents/${document.id}/enrichment`,
        (route) => route.fulfill({ json: { questions: [], summary: null } }),
      )
      await page.route(`**/api/v1/documents/${document.id}/coverage`, (route) =>
        route.fulfill({
          json: {
            source_type: document.source_type,
            duration_seconds: document.duration_seconds,
            segments_total: document.source_type === "audio" ? 4 : 1,
            segments_analyzed:
              analyzed.has(document.id) || analysisStates.has(document.id)
                ? 1
                : 0,
            segments_indexed: 0,
            processing:
              analysisStates.has(document.id) &&
              analysisStates.get(document.id) !== "SUCCEEDED"
                ? {
                    kind: "media_analysis",
                    state: analysisStates.get(document.id),
                    progress: 50,
                    checkpoint: 1,
                    error_message:
                      analysisStates.get(document.id) === "FAILED"
                        ? "Error controlado de análisis"
                        : null,
                  }
                : null,
            temporal_precision_seconds: 10,
            analysis_status: analyzed.has(document.id) ? "READY" : "PENDING",
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
                  text: "Evidencia del análisis controlado",
                },
              ],
              total: 1,
              offset: 0,
              limit: 30,
            },
          }),
      )
      await page.route(
        `**/api/v1/documents/${document.id}/analyze`,
        async (route) => {
          expect(route.request().postDataJSON()).toEqual({
            provider: "gemini",
            model: "gemini-2.5-flash",
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
          ).toEqual(["chat", "media_analysis"])
          analysisStates.set(
            document.id,
            document.source_type === "audio" ? "RUNNING" : "SUCCEEDED",
          )
          if (document.source_type !== "audio") analyzed.add(document.id)
          await route.fulfill({
            json: {
              id: `analysis-${document.id}`,
              state: analysisStates.get(document.id),
            },
          })
        },
      )
    }
    await page.route(
      `**/api/v1/conversations/${conversation.id}/messages`,
      async (route) => {
        if (route.request().method() === "POST") {
          expect(route.request().postDataJSON().document_ids.sort()).toEqual(
            createdIds.sort(),
          )
          completed = true
          await route.fulfill({
            contentType: "text/event-stream",
            body: `event: start\ndata: {"message_id":"temporal-response"}\n\nevent: done\ndata: {"message_id":"temporal-response"}\n\n`.replaceAll(
              "\\n",
              "\n",
            ),
          })
        } else
          await route.fulfill({
            json: completed
              ? [
                  {
                    id: "temporal-response",
                    role: "assistant",
                    content:
                      "Comparación con evidencia [Fuente 1] y [Fuente 2].",
                    state: "COMPLETE",
                    created_at: new Date().toISOString(),
                    citations,
                  },
                ]
              : [],
          })
      },
    )
    for (const document of [audio, movie]) {
      await page
        .getByRole("button", {
          name: `Abrir fuente ${document.title}`,
          exact: true,
        })
        .click()
      await page
        .locator("summary")
        .filter({ hasText: "Transcripción completa (opcional)" })
        .click()
      await expect(
        page.getByText("Transcripción con Gemini", { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Autorizar análisis y chat con Gemini",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 30000 })
      await page
        .getByRole("button", {
          name: "Autorizar análisis y chat con Gemini",
          exact: true,
        })
        .click()
      if (document.source_type === "audio") {
        await expect(
          page.getByRole("progressbar", {
            name: "Progreso del análisis multimedia",
          }),
        ).toHaveAttribute("value", "50")
        await expect(
          page.getByText("1/4 segmentos analizados", { exact: true }),
        ).toBeVisible({ timeout: 10000 })
        await expect(
          page.getByRole("progressbar", {
            name: "Progreso de preparación de la fuente",
          }),
        ).toHaveAttribute("value", "50")
        const pendingDraft = page.getByRole("textbox", {
          name: "Pregunta sobre tus documentos",
        })
        await pendingDraft.fill("Borrador durante el análisis")
        analysisStates.set(document.id, "FAILED")
        await expect(
          page
            .getByTestId("workspace-reader")
            .getByText("Error controlado de análisis", { exact: true }),
        ).toBeVisible({ timeout: 10000 })
        await page
          .getByRole("button", {
            name: "Reintentar procesamiento",
            exact: true,
          })
          .click()
        await expect(pendingDraft).toHaveValue("Borrador durante el análisis")
      }
      await expect(page.getByTestId("media-segment")).toBeVisible()
    }
    expect(analyzed.size).toBe(2)
    await expect(page.locator("video")).toBeVisible()
    const question = page.getByRole("textbox", {
      name: "Pregunta sobre tus documentos",
    })
    await question.fill("Compara las dos fuentes con citas al minuto")
    await expect(
      page.getByRole("button", { name: "Preguntar", exact: true }),
    ).toBeEnabled()
    await page.getByRole("button", { name: "Preguntar", exact: true }).click()
    await expect(page.getByTestId("chat-messages")).toContainText(
      "Comparación con evidencia",
    )
    await question.fill("Mi siguiente pregunta permanece escrita")
    await page.getByRole("button", { name: /Fuente \d+.*00:10–00:20/ }).click()
    await expect(page.locator("audio")).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((element) => (element as HTMLMediaElement).currentTime),
      )
      .toBeGreaterThanOrEqual(10)
    await expect(question).toHaveValue(
      "Mi siguiente pregunta permanece escrita",
    )
    await page.getByTestId("media-segment").click()
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((element) => (element as HTMLMediaElement).currentTime),
      )
      .toBeGreaterThanOrEqual(10)
    await page.screenshot({
      path: testInfo.outputPath("workspace-audio-citation.png"),
      fullPage: false,
    })
    await page
      .getByRole("button", { name: "Cerrar visor de fuente", exact: true })
      .click()
    await expect(page.getByTestId("workspace-reader")).toHaveCount(0)
    await expect(question).toHaveValue(
      "Mi siguiente pregunta permanece escrita",
    )
    await page.goto(`/workspaces/${workspace.id}?document=${audio.id}&time=15`)
    await expect(page.locator("audio")).toBeVisible()
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((element) => (element as HTMLMediaElement).currentTime),
      )
      .toBeGreaterThanOrEqual(15)
    await expect(page.getByTestId("workspace-chat")).toBeVisible()
  } finally {
    test.setTimeout(testInfo.timeout + 30000)
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
    for (const id of createdIds)
      await page.request.delete(`${api}/documents/${id}`)
  }
})
