import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

test("create and download a local combined PDF, inspect lineage and permissions", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000)
  const api = "http://localhost:8000/api/v1"
  const stamp = Date.now()
  const documentIds: string[] = []
  let workspaceId = ""
  try {
    const workspaceResponse = await page.request.post(`${api}/workspaces/`, {
      data: { name: `Studio acceptance ${stamp}` },
    })
    expect(workspaceResponse.ok()).toBeTruthy()
    workspaceId = (await workspaceResponse.json()).id
    const originals: { id: string; title: string }[] = []
    for (const [index, filename] of [
      "digital_es.pdf",
      "english_conflict.pdf",
    ].entries()) {
      const response = await page.request.post(`${api}/documents/`, {
        multipart: {
          file: {
            name: `Studio source ${stamp}-${index}.pdf`,
            mimeType: "application/pdf",
            buffer: Buffer.concat([
              fs.readFileSync(
                path.resolve(`../backend/tests/fixtures/${filename}`),
              ),
              Buffer.from(`\n% studio acceptance ${stamp}${index}`),
            ]),
          },
        },
      })
      expect(response.ok()).toBeTruthy()
      const document = await response.json()
      originals.push(document)
      documentIds.push(document.id)
    }
    await page.goto("/studio/merge")
    await page
      .getByRole("textbox", { name: "Buscar PDF en Studio" })
      .fill(`Studio source ${stamp}`)
    await page
      .getByRole("button", {
        name: `Seleccionar ${originals[0].title}`,
        exact: true,
      })
      .click()
    await page
      .getByRole("button", {
        name: `Seleccionar ${originals[1].title}`,
        exact: true,
      })
      .click()
    await page
      .getByLabel(`Páginas de ${originals[1].title}`, { exact: true })
      .fill("1")
    await page
      .getByLabel("Nombre de la copia", { exact: true })
      .fill(`Studio combined ${stamp}.pdf`)
    await page.getByRole("combobox", { name: "Destino de la copia" }).click()
    await page
      .getByRole("option", { name: `Studio acceptance ${stamp}`, exact: true })
      .click()
    const creation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/studio/operations"),
    )
    await page.getByRole("button", { name: "Crear copia", exact: true }).click()
    const result = await (await creation).json()
    documentIds.push(result.document.id)
    expect(result.document.page_count).toBe(3)
    await expect(
      page.getByRole("heading", { name: result.document.title, exact: true }),
    ).toBeVisible()
    const download = page.waitForEvent("download")
    await page
      .getByRole("button", { name: "Descargar copia", exact: true })
      .click()
    const file = await download
    expect(file.suggestedFilename()).toBe(result.document.title)
    const downloadedPath = await file.path()
    expect(
      downloadedPath &&
        fs.readFileSync(downloadedPath).subarray(0, 5).toString(),
    ).toBe("%PDF-")
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`${api}/documents/${result.document.id}`)
            ).json()
          ).status,
        { timeout: 90000 },
      )
      .toMatch(/EXTRACTED|DEGRADED|READY/)
    await page.screenshot({
      path: testInfo.outputPath("studio-desktop.png"),
      fullPage: true,
    })
    await page.goto("/trace/documents")
    await page
      .getByRole("button")
      .filter({ hasText: result.document.title })
      .first()
      .click()
    const detail = page.getByRole("dialog")
    await expect(
      detail.getByRole("heading", { name: "Historia de la fuente" }),
    ).toBeVisible()
    await expect(detail).toContainText("docling-native")
    await expect(detail).toContainText("Linaje de Studio")
    await expect(detail).toContainText(result.document.title)
    await page.keyboard.press("Escape")
    const consentResponse = await page.request.post(
      `${api}/documents/${result.document.id}/consents`,
      { data: { provider: "gemini", scope: "chat", expires_in_days: 1 } },
    )
    expect(consentResponse.ok()).toBeTruthy()
    const consent = await consentResponse.json()
    await page.goto("/trace/permissions")
    await page.getByRole("combobox", { name: "Filtrar workspace" }).click()
    await page
      .getByRole("option", { name: `Studio acceptance ${stamp}`, exact: true })
      .click()
    await expect(
      page.getByText(result.document.title, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText("Activo", { exact: true })).toBeVisible()
    expect(
      (
        await page.request.delete(
          `${api}/documents/${result.document.id}/consents/${consent.id}`,
        )
      ).ok(),
    ).toBeTruthy()
    await page.getByRole("button", { name: "Actualizar", exact: true }).click()
    await expect(page.getByText("Revocado", { exact: true })).toBeVisible()
  } finally {
    if (workspaceId)
      await page.request.delete(`${api}/workspaces/${workspaceId}`)
    for (const identifier of documentIds) {
      const jobs = await (
        await page.request.get(`${api}/documents/${identifier}/jobs`)
      ).json()
      for (const job of jobs)
        if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state))
          await page.request.post(
            `${api}/documents/${identifier}/jobs/${job.id}/cancel`,
          )
      await expect
        .poll(
          async () =>
            (
              await page.request.delete(`${api}/documents/${identifier}`)
            ).status(),
          { timeout: 30000 },
        )
        .toBe(200)
    }
  }
})

test("Studio transforms and trace filters fit a mobile viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ["/studio/transform", "/trace/activity"]) {
    await page.goto(route)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    expect(width).toBeLessThanOrEqual(391)
  }
  await page.screenshot({
    path: testInfo.outputPath("trace-mobile.png"),
    fullPage: true,
  })
})
