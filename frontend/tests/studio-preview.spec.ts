import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

test("private Studio preview retries a failed request and displays authenticated blob pages", async ({
  page,
}) => {
  test.setTimeout(90000)
  const api = "http://localhost:8000/api/v1"
  const stamp = Date.now()
  const response = await page.request.post(`${api}/documents/`, {
    multipart: {
      file: {
        name: `Preview acceptance ${stamp}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.concat([
          fs.readFileSync(
            path.resolve("../backend/tests/fixtures/digital_es.pdf"),
          ),
          Buffer.from(`\n% preview acceptance ${stamp}`),
        ]),
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  const document = await response.json()
  let allowPreview = false
  try {
    await page.route(
      `**/api/v1/studio/documents/${document.id}/pages/1/preview`,
      async (route) => {
        if (!allowPreview) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"detail":"temporary fixture failure"}',
          })
        } else await route.continue()
      },
    )
    await page.goto("/studio/pages")
    await page
      .getByRole("textbox", { name: "Buscar PDF en Studio" })
      .fill(document.title)
    await page
      .getByRole("button", {
        name: `Seleccionar ${document.title}`,
        exact: true,
      })
      .click()
    await expect(page.getByRole("alert")).toContainText(
      "No se pudo preparar la vista previa",
    )
    allowPreview = true
    await page
      .getByRole("button", {
        name: "Volver a cargar vista previa",
        exact: true,
      })
      .click()
    const firstPage = page.getByRole("img", {
      name: `Vista previa de la página 1 de ${document.title}`,
      exact: true,
    })
    await expect(firstPage).toHaveAttribute("src", /^blob:/)
    await expect
      .poll(() =>
        firstPage.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true)
    await page.getByLabel("Ver página original", { exact: true }).fill("2")
    const secondPage = page.getByRole("img", {
      name: `Vista previa de la página 2 de ${document.title}`,
      exact: true,
    })
    await expect(secondPage).toHaveAttribute("src", /^blob:/)
    await expect
      .poll(() =>
        secondPage.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true)
  } finally {
    const jobs = await (
      await page.request.get(`${api}/documents/${document.id}/jobs`)
    ).json()
    for (const job of jobs)
      if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state))
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

test("trace reports an old server HTML response as a recoverable version error", async ({
  page,
}) => {
  await page.route("**/api/v1/trace/overview", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Old application</title>",
    }),
  )
  await page.goto("/trace/activity")
  await expect(
    page.getByRole("heading", { name: "Actividad de tu investigación" }),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toContainText(
    "La versión del servidor todavía no tiene este módulo",
    { timeout: 5000 },
  )
  await expect(
    page.getByRole("button", { name: "Actualizar", exact: true }),
  ).toBeVisible()
})
