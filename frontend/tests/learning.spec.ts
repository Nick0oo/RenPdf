import fs from "node:fs"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"

const api = "http://localhost:8000/api/v1"
type Sources = {
  workspace: { id: string; name: string }
  documents: { id: string; title: string }[]
}

async function makeSources(page: Page, two = false): Promise<Sources> {
  const spaceResponse = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Learning QA ${Date.now()}` },
  })
  expect(spaceResponse.ok()).toBeTruthy()
  const workspace = await spaceResponse.json()
  const documents: { id: string; title: string }[] = []
  try {
    for (const filename of two
      ? ["digital_es.pdf", "english_conflict.pdf"]
      : ["digital_es.pdf"]) {
      const upload = await page.request.post(`${api}/documents/`, {
        multipart: {
          file: {
            name: `Learning-${filename}-${Date.now()}.pdf`,
            mimeType: "application/pdf",
            buffer: Buffer.concat([
              fs.readFileSync(
                path.resolve(`../backend/tests/fixtures/${filename}`),
              ),
              Buffer.from(`\n% learning-qa-${Date.now()}`),
            ]),
          },
        },
      })
      expect(upload.ok()).toBeTruthy()
      const document = await upload.json()
      documents.push(document)
      const attach = await page.request.put(
        `${api}/workspaces/${workspace.id}/documents/${document.id}`,
      )
      expect(attach.ok()).toBeTruthy()
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`${api}/documents/${document.id}`)
              ).json()
            ).current_version_id,
          { timeout: 90000 },
        )
        .toBeTruthy()
    }
    return { workspace, documents }
  } catch (failure) {
    await cleanup(page, { workspace, documents })
    throw failure
  }
}

async function cleanup(page: Page, sources: Sources) {
  await page.request.delete(`${api}/workspaces/${sources.workspace.id}`)
  for (const document of sources.documents) {
    const jobsResponse = await page.request.get(
      `${api}/documents/${document.id}/jobs`,
    )
    if (jobsResponse.ok()) {
      const jobs: { id: string; state: string }[] = await jobsResponse.json()
      for (const job of jobs.filter((item) =>
        ["QUEUED", "RUNNING"].includes(item.state),
      ))
        await page.request.post(
          `${api}/documents/${document.id}/jobs/${job.id}/cancel`,
        )
    }
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
}

test("save a research question, create source-linked cards and persist a self-assessment", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000)
  const sources = await makeSources(page)
  try {
    await page.goto("/lab/questions")
    await page
      .getByRole("combobox", { name: "Workspace de laboratorio" })
      .click()
    await page
      .getByRole("option", { name: sources.workspace.name, exact: true })
      .click()
    await page
      .getByLabel("Título", { exact: true })
      .fill("Solar research question")
    await page
      .getByLabel("Pregunta", { exact: true })
      .fill("¿Qué capacidad solar tiene el proyecto?")
    await page
      .getByRole("button", { name: "Guardar pregunta pendiente", exact: true })
      .click()
    await expect(
      page.getByRole("region", { name: "Investigaciones guardadas" }),
    ).toContainText("Solar research question")
    await page
      .getByRole("button", {
        name: "Editar Solar research question",
        exact: true,
      })
      .click()
    await page
      .getByLabel("Notas de investigación", { exact: true })
      .fill("Comprobar el dato en la página original")
    await page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click()
    await expect(
      page.getByRole("region", { name: "Investigaciones guardadas" }),
    ).toContainText("Comprobar el dato en la página original")
    const questions = await (
      await page.request.get(
        `${api}/learning/research?workspace_id=${sources.workspace.id}`,
      )
    ).json()
    expect(questions).toHaveLength(1)
    await page.reload()
    await page
      .getByRole("combobox", { name: "Workspace de laboratorio" })
      .click()
    await page
      .getByRole("option", { name: sources.workspace.name, exact: true })
      .click()
    await expect(
      page.getByRole("region", { name: "Investigaciones guardadas" }),
    ).toContainText("Pregunta pendiente")
    await expect(
      page.getByRole("region", { name: "Investigaciones guardadas" }),
    ).toContainText("Comprobar el dato en la página original")

    await page.goto(`/study/decks?workspace=${sources.workspace.id}`)
    await page.getByLabel("Nombre del mazo").fill("Energy facts")
    await page
      .getByLabel("Qué quieres estudiar")
      .fill("Facts supported by the project PDF")
    await page.getByRole("button", { name: "Crear mazo", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Energy facts", exact: true }),
    ).toBeVisible()
    await page.getByRole("link", { name: "Crear fichas", exact: true }).click()
    await page
      .getByLabel("Pregunta de la ficha")
      .fill("¿Cuánta capacidad solar hay?")
    await page.getByLabel("Respuesta de referencia").fill("120 MWh")
    await page.getByRole("combobox", { name: "PDF de la ficha" }).click()
    await page
      .getByRole("option", { name: sources.documents[0].title, exact: true })
      .click()
    await page
      .getByRole("button", { name: "Guardar ficha", exact: true })
      .click()
    const saved = page.getByRole("region", { name: "Fichas guardadas" })
    await expect(saved).toContainText("120 MWh")
    await expect(saved.getByRole("link", { name: /página 1/ })).toHaveAttribute(
      "href",
      new RegExp(`${sources.documents[0].id}/file#page=1$`),
    )
    const decks = await (
      await page.request.get(
        `${api}/learning/decks?workspace_id=${sources.workspace.id}`,
      )
    ).json()
    await page.goto(
      `/study/review?workspace=${sources.workspace.id}&deck=${decks[0].id}`,
    )
    await page.getByLabel("Tu respuesta, antes de mirar").fill("120 MWh")
    await page
      .getByRole("button", { name: "Mostrar respuesta", exact: true })
      .click()
    await page.getByRole("button", { name: "Bien", exact: true }).click()
    await expect(
      page.getByText("Tus repasos están al día", { exact: true }),
    ).toBeVisible()
    await page.reload()
    const progress = await (
      await page.request.get(`${api}/learning/decks/${decks[0].id}/progress`)
    ).json()
    expect(progress.assessment).toBe("self_reported")
    expect(progress.reviews).toBe(1)
    expect(progress.due_cards).toBe(0)
    await expect(
      page.getByText("Tus repasos están al día", { exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBeTruthy()
    await page.screenshot({
      path: testInfo.outputPath("study-mobile.png"),
      fullPage: true,
    })
  } finally {
    await cleanup(page, sources)
  }
})

test("compare two PDFs with real generated citations, then save an existing response as a summary", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_CLOUD_E2E !== "1",
    "Requires explicit synthetic cloud verification",
  )
  test.setTimeout(240000)
  const sources = await makeSources(page, true)
  try {
    for (const document of sources.documents) {
      const consent = await page.request.post(
        `${api}/documents/${document.id}/consents`,
        { data: { provider: "gemini", scope: "chat", expires_in_days: 1 } },
      )
      expect(consent.ok()).toBeTruthy()
    }
    await page.goto("/lab/compare")
    await page
      .getByRole("combobox", { name: "Workspace de laboratorio" })
      .click()
    await page
      .getByRole("option", { name: sources.workspace.name, exact: true })
      .click()
    await page
      .getByLabel("Título", { exact: true })
      .fill("Source capacity comparison")
    await page
      .getByLabel("Tema o pregunta para ambas fuentes", { exact: true })
      .fill(
        "¿Cuál es la capacidad solar instalada? What is the installed solar capacity?",
      )
    for (const document of sources.documents)
      await page.getByRole("checkbox", { name: document.title }).check()
    await page
      .getByRole("combobox", { name: "Modelo de laboratorio", exact: true })
      .click()
    await page
      .getByRole("combobox", { name: "Buscar en Modelo de laboratorio" })
      .fill("gemini-2.5-flash")
    await page
      .getByRole("option", { name: "gemini · gemini-2.5-flash", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Consultar las fuentes", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Guardar investigación", exact: true }),
    ).toBeEnabled({ timeout: 150000 })
    await expect(page.getByRole("alert")).toHaveCount(0)
    await page
      .getByRole("button", { name: "Guardar investigación", exact: true })
      .click()
    await expect(
      page.getByRole("region", { name: "Investigaciones guardadas" }),
    ).toContainText("Source capacity comparison")
    const entries = await (
      await page.request.get(
        `${api}/learning/research?workspace_id=${sources.workspace.id}`,
      )
    ).json()
    expect(entries[0].kind).toBe("comparison")
    expect(entries[0].answers).toHaveLength(2)
    const citedDocuments = entries[0].answers.flatMap(
      (answer: { citations: { document_id: string }[] }) =>
        answer.citations.map((citation) => citation.document_id),
    )
    expect(new Set(citedDocuments)).toEqual(
      new Set(sources.documents.map((document) => document.id)),
    )
    await page
      .getByText("Revisar evidencia y respuestas", { exact: true })
      .click()
    await page.screenshot({
      path: testInfo.outputPath("lab-comparison-desktop.png"),
      fullPage: true,
    })

    await page.goto("/lab/summaries")
    await page
      .getByRole("combobox", { name: "Workspace de laboratorio" })
      .click()
    await page
      .getByRole("option", { name: sources.workspace.name, exact: true })
      .click()
    await page
      .getByLabel("Título", { exact: true })
      .fill("Saved solar response")
    await page
      .getByText("Usar una respuesta que ya existe", { exact: true })
      .click()
    await page
      .getByRole("combobox", { name: "Chat de la investigación" })
      .click()
    await page
      .getByRole("option", { name: "Source capacity comparison", exact: true })
      .click()
    await page.getByRole("combobox", { name: "Respuesta con citas" }).click()
    await page.getByRole("option").first().click()
    await page
      .getByRole("button", { name: "Guardar investigación", exact: true })
      .click()
    await expect(
      page.getByRole("region", { name: "Investigaciones guardadas" }),
    ).toContainText("Saved solar response")
    const summaries = await (
      await page.request.get(
        `${api}/learning/research?workspace_id=${sources.workspace.id}`,
      )
    ).json()
    expect(
      summaries.find((entry: { kind: string }) => entry.kind === "summary")
        .answers[0].citations.length,
    ).toBeGreaterThan(0)
  } finally {
    await cleanup(page, sources)
  }
})
