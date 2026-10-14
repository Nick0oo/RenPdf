import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

test("PDF, worker, privacy, grounded chat, citations, rotation and reload", async ({
  page,
}) => {
  test.setTimeout(180000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await page.evaluate(() => localStorage.removeItem("renpdf_workspace"))
  await page.reload()
  await expect(page.getByText("Tus fuentes. Tus respuestas.")).toBeVisible()
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
  await page
    .getByLabel("Añadir documento al workspace")
    .selectOption(document.id)
  await expect(page.locator("[data-testid=pdf-page] canvas")).toBeVisible({
    timeout: 30000,
  })
  await page.getByRole("button", { name: "Iniciar conversación" }).click()
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
    await page
      .getByLabel("Modelo de conversación")
      .selectOption("gemini|gemini-2.5-flash-lite")
    await expect(page.getByTestId("chat-messages")).toContainText("120")
    await page.reload()
    await expect(page.getByLabel("Modelo de conversación")).toHaveValue(
      "gemini|gemini-2.5-flash-lite",
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
      path: "test-results/research-desktop.png",
      fullPage: true,
    })
  }
  await page.getByRole("button", { name: "Fuentes y permisos" }).click()
  await page.getByLabel("Nota personal").fill("Nota persistente de prueba")
  await page.getByRole("button", { name: /Guardar nota/ }).click()
  await expect(
    page.getByRole("button", { name: /Nota persistente de prueba/ }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole("button", { name: "Fuentes y permisos" }).click()
  await expect(
    page.getByRole("button", { name: /Nota persistente de prueba/ }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole("button", { name: "Documento", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Chat", exact: true }).click()
  await expect(page.getByLabel("Pregunta sobre tus documentos")).toBeVisible()
  await page.screenshot({
    path: "test-results/research-mobile.png",
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
  await page.request.delete(`${api}/workspaces/${workspace.id}`)
  await page.request.delete(`${api}/documents/${document.id}`)
})

test("provider catalog and personal routing are available", async ({
  page,
}) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.removeItem("renpdf_workspace"))
  await page.reload()
  await page.getByRole("button", { name: "Modelos", exact: true }).click()
  await expect(page.getByText("Modelos y procesamiento")).toBeVisible()
  await expect(page.getByText("llamacpp", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Modelo para Conversación")).toBeVisible()
})
