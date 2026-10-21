import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const api = "http://localhost:8000/api/v1"

test("Excel keeps cached values, exposes missing formula results and opens cited cells beside a stable chat", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  const response = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Excel verificable ${Date.now()}` },
  })
  expect(response.ok()).toBeTruthy()
  const workspace = await response.json()
  const created: string[] = []
  try {
    await page.goto(`/workspaces/${workspace.id}`)
    await page.getByTestId("workspace-pdf-upload").setInputFiles([
      {
        name: `Ventas-${Date.now()}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: fs.readFileSync(
          path.resolve("../backend/tests/fixtures/spreadsheet_workspace.xlsx"),
        ),
      },
      {
        name: `Revision-${Date.now()}.xlsx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: fs.readFileSync(
          path.resolve("../backend/tests/fixtures/spreadsheet_revision.xlsx"),
        ),
      },
    ])
    let document: any
    let extractedDocuments: any[] = []
    await expect
      .poll(
        async () => {
          const rows = await (
            await page.request.get(
              `${api}/workspaces/${workspace.id}/documents`,
            )
          ).json()
          extractedDocuments = rows
          for (const item of rows)
            if (!created.includes(item.id)) created.push(item.id)
          document = rows.find((item: any) => item.title.startsWith("Ventas-"))
          return (
            rows.length === 2 &&
            rows.every((item: any) => !!item.current_version_id)
          )
        },
        { timeout: 90000 },
      )
      .toBe(true)
    expect(document.source_type).toBe("spreadsheet")
    expect(document.sheet_count).toBe(2)
    const consents = await (
      await page.request.get(`${api}/documents/${document.id}/consents`)
    ).json()
    expect(consents).toEqual([])
    const conversationResponse = await page.request.post(
      `${api}/workspaces/${workspace.id}/conversations`,
      {
        data: {
          title: "Investigar Excel",
          provider: "gemini",
          model: "gemini-2.5-flash",
        },
      },
    )
    const conversation = await conversationResponse.json()
    // Chat responses are controlled here; the viewer must not depend on a busy shared embedding worker.
    await page.route(
      `**/api/v1/workspaces/${workspace.id}/documents`,
      (route) =>
        route.fulfill({
          json: extractedDocuments.map((item) => ({
            ...item,
            status: "READY",
            active_index_id: "00000000-0000-4000-8000-000000000014",
          })),
        }),
    )
    let complete = false
    await page.route(
      `**/api/v1/conversations/${conversation.id}/messages`,
      async (route) => {
        if (route.request().method() === "POST") {
          expect(route.request().postDataJSON().document_ids.sort()).toEqual(
            [...created].sort(),
          )
          complete = true
          await route.fulfill({
            contentType: "text/event-stream",
            body: 'event: start\ndata: {"message_id":"excel-response"}\n\nevent: done\ndata: {"message_id":"excel-response"}\n\n',
          })
        } else
          await route.fulfill({
            json: complete
              ? [
                  {
                    id: "excel-response",
                    role: "assistant",
                    state: "COMPLETE",
                    created_at: new Date().toISOString(),
                    content: "El presupuesto es 225 [Fuente 1].",
                    citations: [
                      {
                        label: 1,
                        document_id: document.id,
                        document_title: document.title,
                        version_id: document.current_version_id,
                        source_type: "spreadsheet",
                        page_number: null,
                        sheet_name: "Resumen",
                        cell_range: "B3",
                        precision: "cell",
                        start_seconds: null,
                        end_seconds: null,
                        chunk_id: "excel-chunk",
                        element_id: "excel-element",
                        bbox: null,
                        rotation: 0,
                        text: "Presupuesto: 225",
                      },
                    ],
                  },
                ]
              : [],
          })
      },
    )
    await page.reload()
    await expect(page.getByTestId("workspace-reader")).toHaveCount(0)
    await page
      .getByRole("button", {
        name: `Abrir fuente ${document.title}`,
        exact: true,
      })
      .click()
    await expect(page.getByTestId("spreadsheet-reader")).toBeVisible()
    await page.getByRole("tab", { name: "Ventas", exact: true }).click()
    const target = page.getByRole("textbox", {
      name: "Ir a celda",
      exact: true,
    })
    await target.fill("D2")
    await target.press("Enter")
    await expect(page.getByTestId("cell-formula")).toContainText("SUM(B2:C2)")
    await expect(page.getByTestId("cell-value")).toContainText("30")
    await target.fill("E2")
    await target.press("Enter")
    await expect(page.getByTestId("cell-formula")).toContainText("B2*10")
    await expect(page.getByTestId("cell-value")).toHaveText(
      "Sin resultado guardado",
    )
    await page
      .getByRole("button", { name: "Columnas siguientes", exact: true })
      .click()
    await expect(
      page.getByRole("columnheader", { name: "R", exact: true }),
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Filas siguientes", exact: true })
      .click()
    await expect(page.getByTestId("selected-cell")).toHaveAttribute(
      "data-coordinate",
      "M31",
    )
    const question = page.getByRole("textbox", {
      name: "Pregunta sobre tus documentos",
    })
    await question.fill("¿Cuál es el presupuesto guardado?")
    await expect(
      page.getByRole("button", { name: "Preguntar", exact: true }),
    ).toBeEnabled({ timeout: 90000 })
    await page.getByRole("button", { name: "Preguntar", exact: true }).click()
    await expect(page.getByTestId("chat-messages")).toContainText(
      "El presupuesto es 225",
    )
    await question.fill("Este borrador permanece al navegar las hojas")
    await page.getByRole("button", { name: /Fuente 1.*Resumen · B3/ }).click()
    await expect(
      page.getByRole("tab", { name: "Resumen", exact: true }),
    ).toHaveAttribute("data-state", "active")
    await expect(page.getByTestId("selected-cell")).toHaveAttribute(
      "data-coordinate",
      "B3",
    )
    await expect(page.getByTestId("cell-value")).toContainText("225")
    await expect(question).toHaveValue(
      "Este borrador permanece al navegar las hojas",
    )
    await page.screenshot({
      path: testInfo.outputPath("workspace-excel-desktop.png"),
    })
    await page.getByRole("button", { name: "Cerrar visor de fuente" }).click()
    await expect(page.getByTestId("workspace-reader")).toHaveCount(0)
    await expect(question).toHaveValue(
      "Este borrador permanece al navegar las hojas",
    )
    await page.goto(
      `/workspaces/${workspace.id}?document=${document.id}&sheet=Resumen&cell=B40`,
    )
    await expect(page.getByTestId("selected-cell")).toHaveAttribute(
      "data-coordinate",
      "B40",
    )
    await expect(page.getByTestId("cell-value")).toContainText("Fila cuarenta")
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId("workspace-chat")).toBeVisible()
    await expect(page.getByTestId("spreadsheet-reader")).toBeVisible()
    await expect(page.getByTestId("selected-cell")).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath("workspace-excel-mobile.png"),
    })
  } finally {
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
    for (const id of created)
      await page.request.delete(`${api}/documents/${id}`)
  }
})
