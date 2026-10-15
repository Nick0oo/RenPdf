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
    await expect(page.locator("[data-testid=pdf-page] canvas")).toHaveCount(0)
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
    await page.getByRole("button", { name: "Abrir PDF", exact: true }).click()
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
    await page
      .getByRole("button", { name: "Revisar fuentes y permisos", exact: true })
      .click()
    await expect(
      page.getByRole("tab", { name: "Privacidad", exact: true }),
    ).toHaveAttribute("data-state", "active")
    await expect(page.getByText("Autorizar envíos a gemini")).toBeVisible()
    await page.keyboard.press("Escape")
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
