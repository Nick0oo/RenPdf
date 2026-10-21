import fs from "node:fs"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import type {
  Card,
  Deck,
  Generation,
  ResearchEntry,
} from "../src/features/lab/api"

const api = "http://localhost:8000/api/v1"

// Only invented sources and controlled generation responses are used below.
// The existing manual flow also exercises persistence against the real API.
async function learningFixture(page: Page) {
  const workspace = "10000000-0000-4000-8000-000000000001"
  const documentIds = [2, 3, 4, 5].map(
    (id) => `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  )
  const version = "10000000-0000-4000-8000-000000000006"
  const messageId = "10000000-0000-4000-8000-000000000007"
  const documents = [
    "Proyecto solar.pdf",
    "Ventas.xlsx",
    "Clase solar.wav",
    "Video preparando.mp4",
  ].map((title, index) => ({
    id: documentIds[index],
    title,
    source_type: ["pdf", "spreadsheet", "audio", "video"][index],
    status: index === 3 ? "MEDIA_READY" : "READY",
    current_version_id: index === 3 ? null : version,
    active_index_id: null,
    page_count: index === 0 ? 4 : 0,
    sheet_count: index === 1 ? 2 : 0,
    duration_seconds: index > 1 ? 90 : null,
  }))
  const citations = documents.slice(0, 3).map((document, index) => ({
    label: index + 1,
    document_id: document.id,
    document_title: document.title,
    version_id: version,
    chunk_id: `chunk-${index}`,
    element_id: `element-${index}`,
    source_type: document.source_type,
    page_number: index === 0 ? 3 : null,
    sheet_name: index === 1 ? "Ventas" : null,
    cell_range: index === 1 ? "B3" : null,
    start_seconds: index === 2 ? 62 : null,
    end_seconds: index === 2 ? 72 : null,
    text: [
      "El proyecto tiene 120 MWh.",
      "Las ventas alcanzan 400 unidades.",
      "La energía solar se almacena.",
    ][index],
    bbox: null,
    score: 0.9,
  }))
  const state = {
    research: [] as ResearchEntry[],
    decks: [] as Deck[],
    cards: [] as Card[],
    requests: [] as Record<string, any>[],
    grants: 0,
    failure: "",
    reviews: [] as Record<string, any>[],
    release: undefined as undefined | (() => void),
    hold: false,
  }
  const trace = {
    policy: { provider: "gemini", model: "gemini-2.5-flash" },
    outcome: "COMPLETE",
    elapsed_seconds: 1.25,
    response_mode: "buffered",
    learning: { kind: "questions", generated_items: 3, storage_state: "saved" },
    retrieval: { candidates: 3 },
    document_snapshots: [],
  }
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const endpoint = url.pathname.replace("/api/v1", "")
    const method = route.request().method()
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, json })
    if (endpoint === "/workspaces/")
      return reply([
        {
          id: workspace,
          name: "Repaso solar sintético",
          description: "Material de pruebas",
        },
      ])
    if (endpoint === `/workspaces/${workspace}/documents`)
      return reply(documents)
    if (endpoint === `/workspaces/${workspace}/conversations`) return reply([])
    if (endpoint === "/providers/")
      return reply([
        {
          name: "gemini",
          status: "AVAILABLE",
          is_cloud: true,
          models: [
            {
              id: "gemini-2.5-flash",
              provider: "gemini",
              version: "fixture",
              capabilities: {
                text: "verified",
                audio: "verified",
                video: "verified",
              },
            },
          ],
        },
      ])
    if (endpoint === "/providers/routing")
      return reply([
        {
          task: "chat",
          scope_key: "personal",
          provider: "gemini",
          model: "gemini-2.5-flash",
        },
      ])
    if (endpoint.endsWith("/consents")) {
      if (method === "POST") state.grants++
      return reply([])
    }
    if (endpoint === `/trace/responses/${messageId}`)
      return reply({ message: { usage: { trace } } })
    if (endpoint === "/learning/research") return reply(state.research)
    if (endpoint === "/learning/decks") return reply(state.decks)
    if (endpoint.match(/^\/learning\/decks\/[^/]+\/cards$/))
      return reply(
        state.cards.filter((card) => endpoint.includes(card.deck_id)),
      )
    if (endpoint.endsWith("/progress"))
      return reply({
        cards: state.cards.length,
        due_cards: state.cards.filter(
          (card) => new Date(card.due_at).getTime() < Date.now(),
        ).length,
        reviewed_cards: state.reviews.length,
        reviews: state.reviews.length,
        ratings: { good: state.reviews.length },
        assessment: "self_reported",
      })
    if (endpoint.endsWith("/reviews") && method === "GET")
      return reply(state.reviews)
    if (
      endpoint.match(/^\/learning\/cards\/[^/]+\/reviews$/) &&
      method === "POST"
    ) {
      const card = state.cards.find((card) => endpoint.includes(card.id))!
      card.due_at = new Date(Date.now() + 3 * 86400000).toISOString()
      const review = {
        id: `review-${state.reviews.length}`,
        card_id: card.id,
        ...route.request().postDataJSON(),
        created_at: new Date().toISOString(),
        next_due_at: card.due_at,
      }
      state.reviews.push(review)
      return reply(review)
    }
    if (endpoint === "/learning/generate" && method === "POST") {
      const input = route.request().postDataJSON()
      state.requests.push(input)
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve
        })
      if (state.failure)
        return reply(
          {
            code: state.failure,
            detail:
              "Falta autorización de chat para las fuentes seleccionadas.",
          },
          409,
        )
      const date = new Date().toISOString()
      const selectedCitations = citations.filter((citation) =>
        input.document_ids.includes(citation.document_id),
      )
      let deck: Deck | null = null
      const cards: Card[] = []
      if (input.kind !== "summary") {
        deck = state.decks.find((deck) => deck.id === input.deck_id) ?? {
          id: `10000000-0000-4000-8000-${String(20 + state.decks.length).padStart(12, "0")}`,
          workspace_id: workspace,
          name: input.title || "Mazo solar generado",
          description: input.focus || "",
          created_at: date,
          cards: 0,
          due_cards: 0,
          reviews: 0,
        }
        if (!state.decks.includes(deck)) state.decks.push(deck)
        for (let index = 0; index < input.count; index++)
          cards.push({
            id: `generated-${state.cards.length + index}`,
            deck_id: deck.id,
            question: `Pregunta solar ${state.cards.length + index + 1}`,
            answer: `Respuesta respaldada ${index + 1}`,
            document_id: documentIds[0],
            version_id: version,
            page_number: 3,
            source_message_id: messageId,
            citation_label: 1,
            created_at: date,
            due_at: new Date(0).toISOString(),
            review_count: 0,
            source_title: documents[0].title,
            source_available: true,
            evidence: selectedCitations[0] as any,
            evidences: selectedCitations as any,
          })
        state.cards.push(...cards)
        deck.cards += cards.length
        deck.due_cards += cards.length
      }
      const research: ResearchEntry[] =
        input.kind === "deck"
          ? []
          : [
              {
                id: `research-${state.research.length}`,
                workspace_id: workspace,
                kind: input.kind === "summary" ? "summary" : "question",
                title: input.title || "Material solar generado",
                question: input.focus || "",
                notes: "",
                document_ids: input.document_ids,
                created_at: date,
                answers: [
                  {
                    message_id: messageId,
                    available: true,
                    content:
                      input.kind === "summary"
                        ? "## Conceptos principales\nEl proyecto combina energía solar y almacenamiento. [1]"
                        : "## Banco de preguntas\n¿Qué capacidad solar existe?\n120 MWh. [1]",
                    provider: "gemini",
                    model: "gemini-2.5-flash",
                    citations: selectedCitations as any,
                    usage: { trace },
                  },
                ],
              },
            ]
      state.research.push(...research)
      const result: Generation = {
        kind: input.kind,
        message_id: messageId,
        conversation_id: "conversation-synthetic",
        research,
        deck,
        cards,
        coverage: {},
      }
      return reply(result)
    }
    return route.continue()
  })
  return { workspace, documents, state }
}
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

test("AI summary selects sources, preserves pending state and saves citations with trace", async ({
  page,
}, testInfo) => {
  const { workspace, documents, state } = await learningFixture(page)
  state.hold = true
  await page.goto(`/lab/summaries?workspace=${workspace}`)
  const generator = page.getByRole("region", {
    name: "Generar material con IA",
    exact: true,
  })
  await expect(
    generator.getByRole("checkbox", {
      name: `Usar ${documents[3].title} para generar`,
    }),
  ).toBeDisabled()
  await generator
    .getByRole("checkbox", { name: `Usar ${documents[2].title} para generar` })
    .uncheck()
  await generator
    .getByLabel("Nombre del material (opcional)")
    .fill("Guía solar para el examen")
  await generator
    .getByLabel("Enfoque o temas que quieres practicar")
    .fill("Energía y ventas")
  await generator
    .getByRole("button", { name: "Generar resumen", exact: true })
    .click()
  await expect(
    generator.getByRole("button", {
      name: "Preparando material con tus fuentes…",
    }),
  ).toBeDisabled()
  await expect(
    generator.getByLabel("Nombre del material (opcional)"),
  ).toBeDisabled()
  await expect.poll(() => state.requests.length).toBe(1)
  expect(state.requests[0]).toEqual({
    workspace_id: workspace,
    kind: "summary",
    document_ids: documents.slice(0, 2).map((document) => document.id),
    provider: "gemini",
    model: "gemini-2.5-flash",
    title: "Guía solar para el examen",
    focus: "Energía y ventas",
  })
  state.release!()
  const result = page.getByRole("region", {
    name: "Material generado",
    exact: true,
  })
  await expect(result).toContainText("Material guardado")
  await expect(result).toContainText("Conceptos principales")
  await result.getByText(/Fuente 2 · Ventas.xlsx/).click()
  await expect(
    result.getByRole("link", { name: "Abrir fuente en el workspace" }),
  ).toHaveAttribute("href", /sheet=Ventas&cell=B3/)
  await result
    .getByRole("button", { name: "Ver trazabilidad", exact: true })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Completa")
  await expect(dialog).toContainText("Material de estudio guardado")
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await page
    .getByRole("heading", { name: "Resúmenes guardados", exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath("lab-ai-summary-desktop.png"),
    fullPage: true,
  })
  await page.reload()
  await expect(
    page.getByRole("region", { name: "Investigaciones guardadas" }),
  ).toContainText("Guía solar para el examen")
  expect(state.grants).toBe(0)
})

test("AI questions create one saved bank and a deck that can be reviewed with all source locations", async ({
  page,
}, testInfo) => {
  const { workspace, state } = await learningFixture(page)
  await page.goto(`/lab/questions?workspace=${workspace}`)
  const generator = page.getByRole("region", {
    name: "Generar material con IA",
    exact: true,
  })
  await generator
    .getByLabel("Nombre del material (opcional)")
    .fill("Repaso energía")
  await generator.getByLabel("Cantidad de preguntas").fill("3")
  await generator
    .getByRole("button", { name: "Generar preguntas y mazo", exact: true })
    .click()
  const result = page.getByRole("region", {
    name: "Material generado",
    exact: true,
  })
  await expect(result).toContainText("3 fichas")
  expect(state.research).toHaveLength(1)
  expect(state.research[0].kind).toBe("question")
  expect(state.requests[0].count).toBe(3)
  await result.getByRole("link", { name: "Repasar mazo", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Sesión de repaso" }),
  ).toContainText("Pregunta solar 1")
  await page
    .getByLabel("Tu respuesta, antes de mirar")
    .fill("Mi respuesta recordada")
  await page
    .getByRole("button", { name: "Mostrar respuesta", exact: true })
    .click()
  const session = page.getByRole("region", { name: "Sesión de repaso" })
  await expect(session).toContainText("Respuesta respaldada 1")
  await expect(session).toContainText("Ventas · B3")
  await expect(session).toContainText("01:02–01:12")
  await session.getByText(/Fuente 1 · Proyecto solar.pdf/).click()
  await expect(
    session.getByRole("link", { name: "Abrir fuente en el workspace" }),
  ).toHaveAttribute("href", /page=3/)
  await page.getByRole("button", { name: "Bien", exact: true }).click()
  await expect(session).toContainText("Pregunta solar 2")
  expect(state.reviews[0].response).toBe("Mi respuesta recordada")
  expect(state.reviews[0].rating).toBe("good")
  await page.reload()
  await expect(session).toContainText("Pregunta solar 2")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy()
  await page.screenshot({
    path: testInfo.outputPath("study-ai-review-mobile.png"),
    fullPage: true,
  })
  expect(state.grants).toBe(0)
})

test("AI deck validates count, requests consent explicitly and adds cards to the chosen deck", async ({
  page,
}, testInfo) => {
  const { workspace, documents, state } = await learningFixture(page)
  state.failure = "CONSENT_REQUIRED"
  await page.goto(`/study/decks?workspace=${workspace}`)
  const generator = page.getByRole("region", {
    name: "Generar material con IA",
    exact: true,
  })
  await generator
    .getByLabel("Nombre del material (opcional)")
    .fill("Mazo de energía")
  await generator
    .getByLabel("Enfoque o temas que quieres practicar")
    .fill("Almacenamiento solar")
  await generator.getByLabel("Cantidad de preguntas").fill("2")
  await expect(
    generator.getByRole("button", { name: "Generar mazo", exact: true }),
  ).toBeDisabled()
  await generator.getByLabel("Cantidad de preguntas").fill("21")
  await expect(
    generator.getByRole("button", { name: "Generar mazo", exact: true }),
  ).toBeDisabled()
  await generator.getByLabel("Cantidad de preguntas").fill("3")
  await generator
    .getByRole("checkbox", { name: `Usar ${documents[2].title} para generar` })
    .uncheck()
  await generator
    .getByRole("button", { name: "Generar mazo", exact: true })
    .click()
  const permissions = page.getByRole("dialog", {
    name: "Permisos para generar material",
  })
  await expect(permissions).toBeVisible()
  await expect(permissions).toContainText("Autorizar envíos a gemini")
  expect(state.grants).toBe(0)
  await permissions.getByRole("button", { name: "Cerrar", exact: true }).click()
  await expect(
    generator.getByLabel("Nombre del material (opcional)"),
  ).toHaveValue("Mazo de energía")
  await expect(
    generator.getByLabel("Enfoque o temas que quieres practicar"),
  ).toHaveValue("Almacenamiento solar")
  await expect(
    generator.getByRole("checkbox", {
      name: `Usar ${documents[2].title} para generar`,
    }),
  ).not.toBeChecked()
  state.failure = ""
  await generator
    .getByRole("button", { name: "Generar mazo", exact: true })
    .click()
  await expect(
    page.getByRole("region", { name: "Material generado", exact: true }),
  ).toContainText("3 fichas")
  state.decks.push({
    ...state.decks[0],
    id: "10000000-0000-4000-8000-000000000090",
    name: "Otro mazo",
    cards: 0,
    due_cards: 0,
  })
  await page.goto(
    `/study/cards?workspace=${workspace}&deck=${state.decks[0].id}`,
  )
  await generator.getByLabel("Cantidad de preguntas").fill("3")
  await generator
    .getByRole("button", { name: "Generar y añadir fichas", exact: true })
    .click()
  await expect(
    page.getByRole("region", { name: "Material generado", exact: true }),
  ).toContainText("3 fichas en «Mazo de energía»")
  expect(state.requests.at(-1)?.deck_id).toBe(state.decks[0].id)
  expect(state.cards).toHaveLength(6)
  await expect(
    page.getByRole("region", { name: "Fichas guardadas" }).getByRole("article"),
  ).toHaveCount(6)
  await page.evaluate(() => document.documentElement.classList.add("dark"))
  await page
    .getByRole("heading", { name: "Fichas con evidencia", exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath("study-ai-cards-dark.png"),
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy()
  await page
    .getByRole("heading", { name: "Fichas con evidencia", exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: testInfo.outputPath("study-ai-cards-mobile.png"),
    fullPage: true,
  })
  await generator
    .getByRole("checkbox", { name: `Usar ${documents[2].title} para generar` })
    .uncheck()
  await page
    .getByRole("combobox", { name: "Mazo de estudio", exact: true })
    .click()
  await page.getByRole("option", { name: "Otro mazo", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "Material generado", exact: true }),
  ).toHaveCount(0)
  await expect(
    generator.getByRole("checkbox", {
      name: `Usar ${documents[2].title} para generar`,
    }),
  ).toBeChecked()
  expect(state.grants).toBe(0)
})

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
      .getByText("Crear manualmente o usar un chat guardado", { exact: true })
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
    await page
      .getByText("Crear o editar un mazo manualmente", { exact: true })
      .click()
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
      .getByText("Crear o editar una ficha manualmente", { exact: true })
      .click()
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

test("generate an AI question bank and saved deck with real Gemini, then start reviewing", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.RUN_CLOUD_E2E !== "1",
    "Requires explicit synthetic cloud verification",
  )
  test.setTimeout(300000)
  const sources = await makeSources(page)
  try {
    for (const document of sources.documents) {
      for (const scope of ["chat", "vision"]) {
        const consent = await page.request.post(
          `${api}/documents/${document.id}/consents`,
          { data: { provider: "gemini", scope, expires_in_days: 1 } },
        )
        expect(consent.ok()).toBeTruthy()
      }
    }
    await page.goto(`/lab/questions?workspace=${sources.workspace.id}`)
    const generator = page.getByRole("region", {
      name: "Generar material con IA",
      exact: true,
    })
    await generator
      .getByLabel("Nombre del material (opcional)")
      .fill("Repaso solar generado desde UI")
    await generator
      .getByLabel("Enfoque o temas que quieres practicar")
      .fill(
        "Proyecto de energía solar: capacidad, almacenamiento y objetivos. Evita colores o detalles de las figuras.",
      )
    await generator.getByLabel("Cantidad de preguntas").fill("3")
    await generator
      .getByRole("combobox", {
        name: "Modelo para generar material",
        exact: true,
      })
      .click()
    await page
      .getByRole("combobox", { name: "Buscar en Modelo para generar material" })
      .fill("gemini-2.5-flash")
    await page
      .getByRole("option", { name: "gemini · gemini-2.5-flash", exact: true })
      .click()
    await generator
      .getByRole("button", { name: "Generar preguntas y mazo", exact: true })
      .click()
    const result = page.getByRole("region", {
      name: "Material generado",
      exact: true,
    })
    await expect(result).toContainText("3 fichas", { timeout: 185000 })
    const decks = await (
      await page.request.get(
        `${api}/learning/decks?workspace_id=${sources.workspace.id}`,
      )
    ).json()
    expect(decks).toHaveLength(1)
    const cards = await (
      await page.request.get(`${api}/learning/decks/${decks[0].id}/cards`)
    ).json()
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(card.source_message_id).toBeTruthy()
      expect(card.evidences.length).toBeGreaterThan(0)
      expect(
        card.evidences.every(
          (evidence: { document_id: string }) =>
            evidence.document_id === sources.documents[0].id,
        ),
      ).toBeTruthy()
    }
    const research = await (
      await page.request.get(
        `${api}/learning/research?workspace_id=${sources.workspace.id}`,
      )
    ).json()
    expect(research).toHaveLength(1)
    expect(research[0].kind).toBe("question")
    await result
      .getByRole("link", { name: "Repasar mazo", exact: true })
      .click()
    const session = page.getByRole("region", { name: "Sesión de repaso" })
    await expect(session).toContainText(cards[0].question)
    await page
      .getByRole("button", { name: "Mostrar respuesta", exact: true })
      .click()
    await expect(session).toContainText(cards[0].answer)
    await page.getByRole("button", { name: "Bien", exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                `${api}/learning/decks/${decks[0].id}/progress`,
              )
            ).json()
          ).reviews,
      )
      .toBe(1)
    await page.screenshot({
      path: testInfo.outputPath("study-ai-real-gemini.png"),
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
      for (const scope of ["chat", "vision"]) {
        const consent = await page.request.post(
          `${api}/documents/${document.id}/consents`,
          { data: { provider: "gemini", scope, expires_in_days: 1 } },
        )
        expect(consent.ok()).toBeTruthy()
      }
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
    expect(entries[0].answers).toHaveLength(1)
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
      .getByText("Crear manualmente o usar un chat guardado", { exact: true })
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
