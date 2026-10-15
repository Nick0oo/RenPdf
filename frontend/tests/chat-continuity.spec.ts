import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const api = "http://localhost:8000/api/v1"
const fixture = (name: string) =>
  fs.readFileSync(path.resolve(`../backend/tests/fixtures/${name}`))

test("indexing all pages keeps the draft editable and blocks sending until the index is ready", async ({
  page,
}) => {
  test.setTimeout(120000)
  const upload = await page.request.post(`${api}/documents/`, {
    multipart: {
      file: {
        name: `Indexing-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fixture("digital_es.pdf"),
          Buffer.from(`\n% indexing ${Date.now()}`),
        ]),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const document = await upload.json()
  const workspaceResponse = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Indexación de todas las páginas ${Date.now()}` },
  })
  expect(workspaceResponse.ok()).toBeTruthy()
  const workspace = await workspaceResponse.json()
  let ready = false
  let documentPolls = 0
  let sent = 0
  let completed = false
  try {
    expect(
      (
        await page.request.put(
          `${api}/workspaces/${workspace.id}/documents/${document.id}`,
        )
      ).ok(),
    ).toBeTruthy()
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
    const extractedDocument = await (
      await page.request.get(`${api}/documents/${document.id}`)
    ).json()
    const conversationResponse = await page.request.post(
      `${api}/workspaces/${workspace.id}/conversations`,
      {
        data: {
          title: "Esperar el índice sin perder la pregunta",
          provider: "gemini",
          model: "gemini-2.5-flash",
        },
      },
    )
    expect(conversationResponse.ok()).toBeTruthy()
    const conversation = await conversationResponse.json()
    const messageId = "00000000-0000-4000-8000-000000000002"
    await page.route(
      `**/api/v1/workspaces/${workspace.id}/documents`,
      async (route) => {
        if (route.request().method() !== "GET") return route.continue()
        documentPolls += 1
        await route.fulfill({
          json: [
            {
              ...extractedDocument,
              status: ready ? "READY" : "INDEXING",
              active_index_id: ready
                ? "00000000-0000-4000-8000-000000000003"
                : null,
            },
          ],
        })
      },
    )
    await page.route(
      `**/api/v1/conversations/${conversation.id}/messages`,
      async (route) => {
        if (route.request().method() === "POST") {
          sent += 1
          expect(ready).toBe(true)
          expect(route.request().postDataJSON().question).toBe(
            "Mi pregunta espera el índice completo",
          )
          completed = true
          await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `event: start\ndata: ${JSON.stringify({ message_id: messageId })}\n\nevent: done\ndata: ${JSON.stringify({ message_id: messageId })}\n\n`,
          })
        } else {
          await route.fulfill({
            json: completed
              ? [
                  {
                    id: messageId,
                    role: "assistant",
                    content:
                      "Pregunta enviada después de preparar la búsqueda.",
                    state: "COMPLETE",
                    provider: "gemini",
                    model: "gemini-2.5-flash",
                    retrieval_mode: null,
                    created_at: new Date().toISOString(),
                    citations: [],
                  },
                ]
              : [],
          })
        }
      },
    )
    await page.goto(`/workspaces/${workspace.id}`)
    const question = page.getByRole("textbox", {
      name: "Pregunta sobre tus documentos",
    })
    const send = page.getByRole("button", { name: "Preguntar", exact: true })
    await expect(
      page.getByText(
        /Preparando la búsqueda por significado de todas las páginas/,
      ),
    ).toBeVisible()
    await expect(question).toBeEditable()
    await expect(question).toHaveAttribute(
      "placeholder",
      "Escribe tu pregunta mientras preparamos la búsqueda…",
    )
    await question.fill("Mi pregunta espera el índice completo")
    await expect(send).toBeDisabled()
    await question.press("Enter")
    await expect
      .poll(() => documentPolls, { timeout: 12000 })
      .toBeGreaterThanOrEqual(3)
    expect(sent).toBe(0)
    await expect(question).toHaveValue("Mi pregunta espera el índice completo")
    await expect(send).toBeDisabled()
    ready = true
    await expect(send).toBeEnabled({ timeout: 12000 })
    await expect(question).toHaveValue("Mi pregunta espera el índice completo")
    await expect(
      page.getByText(
        /Preparando la búsqueda por significado de todas las páginas/,
      ),
    ).toHaveCount(0)
    await send.click()
    await expect.poll(() => sent).toBe(1)
    await expect(page.getByTestId("chat-messages")).toContainText(
      "Pregunta enviada después de preparar la búsqueda.",
    )
  } finally {
    test.setTimeout(150000)
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
    const jobs = await (
      await page.request.get(`${api}/documents/${document.id}/jobs`)
    ).json()
    for (const job of jobs.filter((item: { state: string }) =>
      ["QUEUED", "RUNNING"].includes(item.state),
    ))
      await page.request.post(
        `${api}/documents/${document.id}/jobs/${job.id}/cancel`,
      )
    await expect
      .poll(
        async () =>
          (
            await page.request.delete(`${api}/documents/${document.id}`)
          ).status(),
        { timeout: 30000 },
      )
      .toBe(200)
  }
})

test("a pending chat request survives document polls, notes and opening the PDF", async ({
  page,
}) => {
  test.setTimeout(120000)
  const upload = await page.request.post(`${api}/documents/`, {
    multipart: {
      file: {
        name: `Continuity-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fixture("digital_es.pdf"),
          Buffer.from(`\n% continuity ${Date.now()}`),
        ]),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const document = await upload.json()
  const workspaceResponse = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Continuidad ${Date.now()}` },
  })
  expect(workspaceResponse.ok()).toBeTruthy()
  const workspace = await workspaceResponse.json()
  const gate = Promise.withResolvers<void>()
  const received = Promise.withResolvers<void>()
  let finished = false
  let documentLoads = 0
  let documentPolls = 0
  let fullPdfDownloads = 0
  const failedStreams: string[] = []
  try {
    expect(
      (
        await page.request.put(
          `${api}/workspaces/${workspace.id}/documents/${document.id}`,
        )
      ).ok(),
    ).toBeTruthy()
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
    const conversationResponse = await page.request.post(
      `${api}/workspaces/${workspace.id}/conversations`,
      {
        data: {
          title: "Continuidad del chat",
          provider: "gemini",
          model: "gemini-2.5-flash",
        },
      },
    )
    expect(conversationResponse.ok()).toBeTruthy()
    const conversation = await conversationResponse.json()
    const messageId = "00000000-0000-4000-8000-000000000001"
    await page.route(
      `**/api/v1/conversations/${conversation.id}/messages`,
      async (route) => {
        if (route.request().method() === "POST") {
          received.resolve()
          await gate.promise
          finished = true
          await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: `event: start\ndata: ${JSON.stringify({ message_id: messageId })}\n\nevent: token\ndata: ${JSON.stringify({ text: "Respuesta controlada sin envío a proveedores." })}\n\nevent: done\ndata: ${JSON.stringify({ message_id: messageId })}\n\n`,
          })
        } else {
          await route.fulfill({
            json: finished
              ? [
                  {
                    id: messageId,
                    conversation_id: conversation.id,
                    role: "assistant",
                    state: "COMPLETE",
                    content: "Respuesta controlada sin envío a proveedores.",
                    citations: [],
                    created_at: new Date().toISOString(),
                    usage: null,
                  },
                ]
              : [],
          })
        }
      },
    )
    await page.goto(`/workspaces/${workspace.id}`)
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toBeVisible()
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documentLoads += 1
      if (
        new URL(request.url()).pathname ===
        `/api/v1/workspaces/${workspace.id}/documents`
      )
        documentPolls += 1
      if (
        new URL(request.url()).pathname ===
          `/api/v1/documents/${document.id}/file` &&
        request.method() === "GET" &&
        !request.headers().range
      )
        fullPdfDownloads += 1
    })
    page.on("requestfailed", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/v1/conversations/${conversation.id}/messages`
      )
        failedStreams.push(request.failure()?.errorText ?? "failed")
    })
    await page
      .getByRole("textbox", { name: "Pregunta sobre tus documentos" })
      .fill("Mantén esta pregunta mientras consulto mis fuentes")
    await page.getByRole("button", { name: "Preguntar", exact: true }).click()
    await received.promise
    await expect(
      page.getByRole("button", { name: "Detener", exact: true }),
    ).toBeVisible()
    await page
      .getByRole("textbox", { name: "Pregunta sobre tus documentos" })
      .fill("Mi siguiente pregunta queda escrita")
    await page
      .getByRole("textbox", { name: "Nota personal", exact: true })
      .fill("Nota guardada durante la respuesta")
    await page
      .getByRole("button", { name: "Guardar nota", exact: true })
      .click()
    await expect(
      page.getByRole("button", {
        name: "Nota guardada durante la respuesta",
        exact: true,
      }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Abrir PDF", exact: true }).click()
    await expect(page.locator("[data-testid=pdf-page] canvas")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Guardar marcador", exact: true }),
    ).toBeEnabled()
    await page.evaluate(() => {
      const surface = document.querySelector(
        '[data-testid="pdf-render-surface"]',
      )
      if (!surface) throw new Error("No hay lienzo PDF")
      const stats = { emptyFrames: 0, maxCanvases: 1 }
      const observer = new MutationObserver(() => {
        if (!surface.querySelector('[data-testid="pdf-page"] canvas'))
          stats.emptyFrames += 1
        stats.maxCanvases = Math.max(
          stats.maxCanvases,
          surface.querySelectorAll("canvas").length,
        )
      })
      observer.observe(surface, { childList: true, subtree: true })
      ;(window as unknown as { readerStats: typeof stats }).readerStats = stats
    })
    await page
      .getByRole("button", { name: "Página siguiente", exact: true })
      .click()
    await expect(page.getByTestId("pdf-page")).toHaveAttribute("data-page", "2")
    await expect(
      page.getByRole("button", { name: "Guardar marcador", exact: true }),
    ).toBeEnabled()
    await page
      .getByRole("button", { name: "Página anterior", exact: true })
      .click()
    await expect(page.getByTestId("pdf-page")).toHaveAttribute("data-page", "1")
    await expect(
      page.getByRole("button", { name: "Guardar marcador", exact: true }),
    ).toBeEnabled()
    const readerStats = await page.evaluate(
      () =>
        (
          window as unknown as {
            readerStats: { emptyFrames: number; maxCanvases: number }
          }
        ).readerStats,
    )
    expect(readerStats.emptyFrames).toBe(0)
    expect(readerStats.maxCanvases).toBeLessThanOrEqual(2)
    expect(fullPdfDownloads).toBe(1)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(
      page.getByRole("textbox", { name: "Pregunta sobre tus documentos" }),
    ).toHaveValue("Mi siguiente pregunta queda escrita")
    await expect
      .poll(() => documentPolls, { timeout: 12000 })
      .toBeGreaterThanOrEqual(3)
    await expect(
      page.getByRole("button", { name: "Detener", exact: true }),
    ).toBeVisible()
    expect(documentLoads).toBe(0)
    expect(failedStreams).toEqual([])
    expect(fullPdfDownloads).toBe(1)
    gate.resolve()
    await expect(page.getByTestId("chat-messages")).toContainText(
      "Respuesta controlada sin envío a proveedores.",
    )
    await expect(
      page.getByRole("button", { name: "Detener", exact: true }),
    ).toHaveCount(0)
    expect(documentLoads).toBe(0)
    expect(failedStreams).toEqual([])
  } finally {
    gate.resolve()
    test.setTimeout(150000)
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
    await page.request.delete(`${api}/documents/${document.id}`)
  }
})

test("failed workspace details and an HTML module reply stop loading and show an error", async ({
  page,
}) => {
  const response = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Errores de carga ${Date.now()}` },
  })
  expect(response.ok()).toBeTruthy()
  const workspace = await response.json()
  const missingDetails = `**/api/v1/workspaces/${workspace.id}/documents`
  let detailsAttempts = 0
  let moduleAttempts = 0
  try {
    await page.route(missingDetails, async (route) => {
      detailsAttempts += 1
      await route.fulfill({ status: 404, json: { detail: "Not Found" } })
    })
    await page.goto("/")
    await expect(page.getByRole("alert")).toContainText(
      "No se pudieron cargar las fuentes y conversaciones",
    )
    await expect(
      page.getByText("Cargando fuentes…", { exact: true }),
    ).toHaveCount(0)
    expect(detailsAttempts).toBe(1)
    await page.unroute(missingDetails)
    await page.route("**/api/v1/learning/research?**", async (route) => {
      moduleAttempts += 1
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body>API desactualizada</body></html>",
      })
    })
    await page.goto("/lab/questions")
    await expect(page.getByRole("alert")).toContainText(
      "El servidor devolvió una respuesta inesperada",
      { timeout: 5000 },
    )
    await expect(
      page.getByText("Cargando investigaciones…", { exact: true }),
    ).toHaveCount(0)
    expect(moduleAttempts).toBe(1)
    await expect(page.getByTestId("error-component")).toHaveCount(0)
  } finally {
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
  }
})
