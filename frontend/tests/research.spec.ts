import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

test("open a PDF chat directly, continue it, and reach chat first on mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000)
  const api = "http://localhost:8000/api/v1"
  const bytes = fs.readFileSync(
    path.resolve("../backend/tests/fixtures/digital_es.pdf"),
  )
  const upload = await page.request.post(`${api}/documents/`, {
    multipart: {
      file: {
        name: `chat-entry-${Date.now()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([bytes, Buffer.from(`\n% entry ${Date.now()}`)]),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const document = await upload.json()
  let workspaceId = ""
  try {
    await page.goto("/")
    await page.evaluate(() => localStorage.removeItem("renpdf_workspace"))
    await page.reload()
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
    await expect(page.getByLabel("Pregunta sobre tus documentos")).toBeVisible()
    await expect(
      page.getByRole("region", { name: "Chat con tus documentos" }),
    ).toContainText(document.title)
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
    const original = await (
      await page.request.get(`${api}/workspaces/${workspaceId}/conversations`)
    ).json()
    await page.getByRole("button", { name: "Volver a biblioteca" }).click()
    await page
      .getByRole("button", {
        name: `Chatear con ${document.title}`,
        exact: true,
      })
      .click()
    await expect(page.getByLabel("Pregunta sobre tus documentos")).toBeVisible()
    const continued = await (
      await page.request.get(`${api}/workspaces/${workspaceId}/conversations`)
    ).json()
    expect(continued.map((item: { id: string }) => item.id)).toEqual(
      original.map((item: { id: string }) => item.id),
    )
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
    await expect(
      page.getByRole("region", { name: "Historial de chats" }),
    ).toContainText("Chat 2")
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
    await page.reload()
    await expect(page.getByLabel("Pregunta sobre tus documentos")).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("chat-entry-desktop-light.png"),
      fullPage: true,
    })
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "dark"))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByLabel("Pregunta sobre tus documentos")).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("chat-entry-mobile.png"),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole("button", { name: "Gestionar fuentes", exact: true })
      .click()
    await expect(
      page.getByRole("dialog", { name: "Fuentes y permisos" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Generar 5 preguntas", exact: true }),
    ).toBeVisible()
    await page.getByRole("tab", { name: "Privacidad", exact: true }).click()
    await page.getByLabel("Proveedor para autorizaciones").click()
    await page
      .getByRole("option", { name: "gemini · Nube", exact: true })
      .click()
    await expect(page.getByText("Autorizar envíos a gemini")).toBeVisible()
    await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath("privacy-mobile.png"),
      fullPage: false,
    })
    await page.keyboard.press("Escape")
  } finally {
    if (workspaceId)
      await page.request.delete(`${api}/workspaces/${workspaceId}`)
    await page.request.delete(`${api}/documents/${document.id}`)
  }
})

test("PDF, worker, privacy, grounded chat, citations, rotation and reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await page.evaluate(() => localStorage.removeItem("renpdf_workspace"))
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Tu biblioteca", exact: true }),
  ).toBeVisible()
  const bytes = fs.readFileSync(
    path.resolve("../backend/tests/fixtures/digital_es.pdf"),
  )
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/documents/"),
  )
  await page.getByTestId("pdf-upload").setInputFiles({
    name: "e2e-synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([bytes, Buffer.from(`\n% e2e ${Date.now()}`)]),
  })
  const document = await (await uploadResponse).json()
  expect(document.id).toBeTruthy()
  const api = "http://localhost:8000/api/v1"
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`${api}/documents/${document.id}`)
          ).json()
        ).status,
      { timeout: 60000 },
    )
    .toMatch(/EXTRACTED|READY/)
  let workspaceId = ""
  try {
    await page
      .getByRole("button", { name: "Crear workspace", exact: true })
      .click()
    await page.getByLabel("Nombre del workspace").fill(`E2E ${Date.now()}`)
    const workspaceResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/workspaces/"),
    )
    await page
      .getByRole("button", { name: "Crear workspace", exact: true })
      .last()
      .click()
    const workspace = await (await workspaceResponse).json()
    workspaceId = workspace.id
    await page.getByLabel("Añadir documento al workspace").click()
    await page.locator(`[role="option"][data-value="${document.id}"]`).click()
    await expect(page.locator("[data-testid=pdf-page] canvas")).toBeVisible({
      timeout: 30000,
    })
    await page.getByRole("button", { name: "Iniciar conversación" }).click()
    await page.getByLabel("Modelo de conversación").click()
    await page
      .getByRole("option", { name: "gemini · gemini-2.5-flash", exact: true })
      .click()
    await page
      .getByLabel("Pregunta sobre tus documentos")
      .fill("capacidad solar instalada")
    await page.getByRole("button", { name: "Preguntar", exact: true }).click()
    await expect(page.getByTestId("chat-messages")).toContainText("Autoriza", {
      timeout: 30000,
    })
    // These explicit grants cover only this synthetic E2E fixture.
    const cloud = process.env.RUN_CLOUD_E2E === "1"
    if (cloud) {
      for (const scope of ["chat", "embeddings"]) {
        const response = await page.request.post(
          `${api}/documents/${document.id}/consents`,
          { data: { provider: "gemini", scope, expires_in_days: 1 } },
        )
        expect(response.ok()).toBeTruthy()
      }
      const index = await page.request.post(
        `${api}/documents/${document.id}/index`,
        {
          data: {
            provider: "gemini",
            model: "gemini-embedding-2",
            dimensions: 768,
          },
        },
      )
      expect(index.ok()).toBeTruthy()
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`${api}/documents/${document.id}`)
              ).json()
            ).status,
          { timeout: 60000 },
        )
        .toBe("READY")
      await page
        .getByLabel("Pregunta sobre tus documentos")
        .fill("capacidad solar instalada")
      await page.getByRole("button", { name: "Preguntar", exact: true }).click()
      await expect(page.getByTestId("chat-messages")).toContainText("120", {
        timeout: 60000,
      })
      await page
        .getByRole("button", { name: /Fuente 1.*p\. 1/ })
        .last()
        .click()
      const highlight = page.getByTestId("citation-highlight")
      await expect(highlight).toBeVisible()
      await page.getByLabel("Modelo de conversación").click()
      await page
        .getByRole("option", {
          name: "gemini · gemini-2.5-flash-lite",
          exact: true,
        })
        .click()
      await expect(page.getByTestId("chat-messages")).toContainText("120")
      await page.reload()
      await expect(page.getByLabel("Modelo de conversación")).toContainText(
        "gemini-2.5-flash-lite",
      )
      await expect(page.getByTestId("chat-messages")).toContainText("120")
      await page
        .getByRole("button", { name: /Fuente 1.*p\. 1/ })
        .last()
        .click()
      const first = await highlight.boundingBox()
      expect(first?.width).toBeGreaterThan(50)
      await page.getByRole("button", { name: "Aumentar zoom" }).click()
      await expect
        .poll(async () => (await highlight.boundingBox())?.width)
        .toBeGreaterThan(first?.width ?? 0)
      await page.getByRole("button", { name: "Rotar PDF" }).click()
      await expect(highlight).toBeVisible()
      await page.reload()
      await expect(page.getByTestId("chat-messages")).toContainText("120")
      await page
        .getByRole("button", { name: /Fuente 1.*p\. 1/ })
        .last()
        .click()
      await expect(highlight).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath("research-desktop.png"),
        fullPage: true,
      })
    }
    await page
      .getByRole("button", { name: "Fuentes y permisos", exact: true })
      .click()
    await page.getByRole("tab", { name: "Notas", exact: true }).click()
    await page.getByLabel("Nota personal").fill("Nota persistente de prueba")
    await page.getByRole("button", { name: /Guardar nota/ }).click()
    await expect(
      page.getByRole("button", { name: /Nota persistente de prueba/ }),
    ).toBeVisible()
    await page.reload()
    await page
      .getByRole("button", { name: "Fuentes y permisos", exact: true })
      .click()
    await page.getByRole("tab", { name: "Notas", exact: true }).click()
    await expect(
      page.getByRole("button", { name: /Nota persistente de prueba/ }),
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
      page.getByRole("button", { name: "Documento", exact: true }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Chat", exact: true }).click()
    await expect(page.getByLabel("Pregunta sobre tus documentos")).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath("research-mobile.png"),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  } finally {
    if (workspaceId)
      await page.request.delete(`${api}/workspaces/${workspaceId}`)
    await page.request.delete(`${api}/documents/${document.id}`)
  }
})

test("provider catalog and personal routing are available", async ({
  page,
}) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.removeItem("renpdf_workspace"))
  await page.reload()
  await page.getByRole("button", { name: "Modelos", exact: true }).click()
  await expect(page.getByText("Modelos y procesamiento")).toBeVisible()
  await expect(page.getByLabel("Modelo para Conversación")).toBeVisible()
  await page.getByRole("tab", { name: "Conexiones", exact: true }).click()
  await expect(page.getByText("llamacpp", { exact: true })).toBeVisible()
})
