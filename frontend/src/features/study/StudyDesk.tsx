import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BookOpen, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { WorkspacesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  type Card,
  type Deck,
  learningRequest,
  type Progress,
  type ResearchEntry,
  type Review,
} from "@/features/lab/api"
import { LearningGenerator } from "@/features/lab/LearningGenerator"
import { SourceReferences } from "@/features/lab/SourceReferences"
import { sourceLocation, sourceType } from "@/features/media/location"
import { apiRoot, errorMessage } from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"
import { ConfirmationDialog } from "@/features/research/ConfirmationDialog"

export type StudySection = "cards" | "decks" | "review"
const headings = {
  cards: "Fichas con evidencia",
  decks: "Tus mazos de estudio",
  review: "Repaso y progreso",
}
const descriptions = {
  cards:
    "Genera fichas desde tus fuentes o añade las tuyas. Cada respuesta conserva su evidencia para comprobarla.",
  decks:
    "Prepara un mazo con IA, reúne tus fichas por tema y empieza a practicar sin volver a generar el material.",
  review:
    "Recuerda una respuesta antes de verla. Tu valoración decide cuándo volverás a repasarla.",
}
const ratingLabels: Record<string, string> = {
  again: "Otra vez",
  hard: "Difícil",
  good: "Bien",
  easy: "Fácil",
}

export function StudyDesk({ section = "cards" }: { section?: StudySection }) {
  const cache = useQueryClient()
  const [workspace, setWorkspace] = useState(
    () => new URLSearchParams(window.location.search).get("workspace") ?? "",
  )
  const [deckId, setDeckId] = useState(
    () => new URLSearchParams(window.location.search).get("deck") ?? "",
  )
  const [deckName, setDeckName] = useState("")
  const [deckDescription, setDeckDescription] = useState("")
  const [editingDeck, setEditingDeck] = useState<Deck>()
  const [editingCard, setEditingCard] = useState<Card>()
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [documentId, setDocumentId] = useState("")
  const [page, setPage] = useState("1")
  const [citationKey, setCitationKey] = useState("")
  const [sourceMode, setSourceMode] = useState("page")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<{
    kind: "cards" | "decks"
    id: string
    title: string
  }>()
  const [revealed, setRevealed] = useState(false)
  const [response, setResponse] = useState("")
  const [allCards, setAllCards] = useState(false)
  const [selectedReviewCard, setSelectedReviewCard] = useState("")
  const spaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await WorkspacesService.listWorkspaces()).data,
  })
  const decks = useQuery({
    queryKey: ["learning", "decks", workspace],
    queryFn: () => learningRequest<Deck[]>(`/decks?workspace_id=${workspace}`),
    enabled: !!workspace,
  })
  const cards = useQuery({
    queryKey: ["learning", "cards", deckId],
    queryFn: () => learningRequest<Card[]>(`/decks/${deckId}/cards`),
    enabled: !!deckId,
  })
  const documents = useQuery({
    queryKey: ["workspace-documents", workspace],
    queryFn: async () =>
      (
        await WorkspacesService.listWorkspaceDocuments({
          path: { workspace_id: workspace },
        })
      ).data,
    enabled: !!workspace,
  })
  const research = useQuery({
    queryKey: ["learning", "research", workspace],
    queryFn: () =>
      learningRequest<ResearchEntry[]>(`/research?workspace_id=${workspace}`),
    enabled: !!workspace,
  })
  const progress = useQuery({
    queryKey: ["learning", "progress", deckId],
    queryFn: () => learningRequest<Progress>(`/decks/${deckId}/progress`),
    enabled: !!deckId,
  })
  const reviews = useQuery({
    queryKey: ["learning", "reviews", deckId],
    queryFn: () => learningRequest<Review[]>(`/decks/${deckId}/reviews`),
    enabled: !!deckId && section === "review",
  })
  useEffect(() => {
    if (!workspace && spaces.data?.length) setWorkspace(spaces.data[0].id)
  }, [workspace, spaces.data])
  useEffect(() => {
    if (decks.data && !decks.data.some((deck) => deck.id === deckId))
      setDeckId(decks.data[0]?.id ?? "")
  }, [decks.data, deckId])
  const deck = decks.data?.find((item) => item.id === deckId)
  const document = documents.data?.find((item) => item.id === documentId)
  const cited = Array.from(
    new Map(
      (research.data ?? []).flatMap((entry) =>
        entry.answers
          .filter((item) => item.available)
          .flatMap((item) =>
            item.citations.map(
              (citation) =>
                [
                  `${item.message_id}:${citation.label}`,
                  { answer: item, citation, title: entry.title },
                ] as const,
            ),
          ),
      ),
    ).entries(),
  )
  const queue = (cards.data ?? []).filter(
    (card) => allCards || new Date(card.due_at).getTime() <= Date.now(),
  )
  const current =
    queue.find((card) => card.id === selectedReviewCard) ?? queue[0]
  function resetCard() {
    setEditingCard(undefined)
    setQuestion("")
    setAnswer("")
    setDocumentId("")
    setPage("1")
    setCitationKey("")
    setSourceMode("page")
  }
  async function refresh() {
    await cache.invalidateQueries({ queryKey: ["learning"] })
  }
  function changeWorkspace(value: string) {
    setWorkspace(value)
    setDeckId("")
    setEditingDeck(undefined)
    resetCard()
    setRevealed(false)
    setResponse("")
    setSelectedReviewCard("")
    setError("")
  }
  function changeDeck(value: string) {
    setDeckId(value)
    resetCard()
    setRevealed(false)
    setResponse("")
    setSelectedReviewCard("")
    setError("")
  }

  async function saveDeck() {
    setBusy(true)
    setError("")
    try {
      const created = await learningRequest<Deck>(
        editingDeck ? `/decks/${editingDeck.id}` : "/decks",
        editingDeck ? "PATCH" : "POST",
        {
          workspace_id: workspace,
          name: deckName.trim(),
          description: deckDescription.trim(),
        },
      )
      await refresh()
      setDeckId(created.id)
      setDeckName("")
      setDeckDescription("")
      setEditingDeck(undefined)
      toast.success("Mazo guardado")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  async function saveCard() {
    setBusy(true)
    setError("")
    try {
      const source =
        sourceMode === "citation"
          ? {
              source_message_id: citationKey.split(":")[0],
              citation_label: Number(citationKey.split(":")[1]),
            }
          : { document_id: documentId, page_number: Number(page) }
      await learningRequest(
        editingCard ? `/cards/${editingCard.id}` : "/cards",
        editingCard ? "PATCH" : "POST",
        {
          deck_id: deckId,
          question: question.trim(),
          answer: answer.trim(),
          ...source,
        },
      )
      await refresh()
      resetCard()
      toast.success("Ficha guardada")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  async function rate(rating: string) {
    if (!current) return
    setBusy(true)
    setError("")
    try {
      await learningRequest(`/cards/${current.id}/reviews`, "POST", {
        rating,
        response,
      })
      setSelectedReviewCard(
        queue.find((card) => card.id !== current.id)?.id ?? "",
      )
      setRevealed(false)
      setResponse("")
      await refresh()
      toast.success("Repaso guardado")
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  const queryError =
    spaces.error ||
    decks.error ||
    cards.error ||
    progress.error ||
    research.error ||
    documents.error ||
    reviews.error
  return (
    <div className="space-y-6">
      <header>
        <p className="mb-2 text-xs font-medium text-primary">
          ESTUDIO · RECUERDA Y PRACTICA
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {headings[section]}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {descriptions[section]}
        </p>
        <a
          className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-4"
          href={`/lab/summaries${workspace ? `?workspace=${workspace}` : ""}`}
        >
          Volver a Laboratorio para preparar resúmenes y preguntas →
        </a>
      </header>
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <div>
          <Label className="mb-2 block">Workspace</Label>
          <ChoiceSelect
            label="Workspace de estudio"
            placeholder="Elige un workspace"
            value={workspace}
            onValueChange={changeWorkspace}
            disabled={busy}
            options={(spaces.data ?? []).map((space) => ({
              value: space.id,
              label: space.name,
            }))}
          />
        </div>
        {section !== "decks" && (
          <div>
            <Label className="mb-2 block">Mazo</Label>
            <ChoiceSelect
              label="Mazo de estudio"
              placeholder="Crea o elige un mazo"
              value={deckId}
              onValueChange={changeDeck}
              disabled={busy}
              options={(decks.data ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </div>
        )}
      </div>
      {(error || queryError) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error || errorMessage(queryError)}
        </p>
      )}
      {!spaces.isPending && !spaces.data?.length && (
        <p className="rounded-xl border border-dashed p-6 text-sm">
          Crea un workspace y añade tus fuentes para preparar material de
          estudio.
        </p>
      )}
      {workspace && section !== "review" && (
        <LearningGenerator
          key={`${workspace}:${section}`}
          workspaceId={workspace}
          kind="deck"
          deckId={section === "cards" ? deckId : undefined}
          disabled={busy}
          onBusyChange={setBusy}
          onGenerated={(result) => {
            if (result.deck) setDeckId(result.deck.id)
          }}
        />
      )}
      {workspace &&
        section === "review" &&
        !decks.isPending &&
        !decks.data?.length && (
          <div className="rounded-2xl border border-dashed p-6">
            <h2 className="font-semibold">Prepara tu primer repaso</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Genera un mazo desde tus fuentes y vuelve aquí para practicar.
            </p>
            <Button asChild className="mt-4">
              <a href={`/study/decks?workspace=${workspace}`}>
                Generar un mazo con IA
              </a>
            </Button>
          </div>
        )}
      {workspace &&
        (section === "decks" ||
          (section === "cards" && !decks.data?.length)) && (
          <section className="space-y-5" aria-label="Mazos de estudio">
            <details
              open={!!editingDeck || undefined}
              className="rounded-2xl border"
            >
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
                Crear o editar un mazo manualmente
              </summary>
              <form
                className="space-y-4 border-t p-5 md:p-6"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (deckName.trim()) void saveDeck()
                }}
              >
                <h2 className="text-lg font-semibold">
                  {editingDeck ? "Editar mazo" : "Crea tu primer mazo"}
                </h2>
                <div className="space-y-2">
                  <Label htmlFor="deck-name">Nombre del mazo</Label>
                  <Input
                    id="deck-name"
                    maxLength={120}
                    value={deckName}
                    disabled={busy}
                    onChange={(event) => setDeckName(event.target.value)}
                    placeholder="Conceptos para el examen"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="deck-description">Qué quieres estudiar</Label>
                  <textarea
                    id="deck-description"
                    rows={3}
                    maxLength={2000}
                    value={deckDescription}
                    disabled={busy}
                    onChange={(event) => setDeckDescription(event.target.value)}
                    className="w-full rounded-lg border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || !deckName.trim()}>
                    <Plus size={15} />
                    {editingDeck ? "Guardar mazo" : "Crear mazo"}
                  </Button>
                  {editingDeck && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingDeck(undefined)
                        setDeckName("")
                        setDeckDescription("")
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              </form>
            </details>
            <h2 className="text-lg font-semibold">Mazos guardados</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {decks.data?.map((item) => (
                <article key={item.id} className="rounded-xl border p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {item.cards} fichas · {item.due_cards} pendientes ·{" "}
                        {item.reviews} repasos
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Editar mazo ${item.name}`}
                        onClick={() => {
                          setEditingDeck(item)
                          setDeckName(item.name)
                          setDeckDescription(item.description)
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Eliminar mazo ${item.name}`}
                        onClick={() =>
                          setDeleting({
                            kind: "decks",
                            id: item.id,
                            title: item.name,
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-4">
                    <a
                      className="text-sm text-primary underline underline-offset-4"
                      href={`/study/cards?workspace=${item.workspace_id}&deck=${item.id}`}
                    >
                      Crear fichas
                    </a>
                    <a
                      className="text-sm text-primary underline underline-offset-4"
                      href={`/study/review?workspace=${item.workspace_id}&deck=${item.id}`}
                    >
                      Repasar
                    </a>
                  </div>
                </article>
              ))}
              {!decks.isPending && !decks.data?.length && (
                <p className="pt-3 text-sm leading-6 text-muted-foreground">
                  Un mazo reúne las fichas de este workspace. Después podrás
                  añadir preguntas y repasarlas sin llamar a ningún modelo.
                </p>
              )}
            </div>
          </section>
        )}
      {section === "cards" && deck && (
        <div className="space-y-6">
          <details
            open={!!editingCard || undefined}
            className="rounded-2xl border"
          >
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
              Crear o editar una ficha manualmente
            </summary>
            <form
              className="min-w-0 space-y-5 border-t p-5 md:p-6"
              aria-label="Crear ficha"
              onSubmit={(event) => {
                event.preventDefault()
                void saveCard()
              }}
            >
              <h2 className="text-lg font-semibold">
                {editingCard ? "Editar ficha" : "Una idea por ficha"}
              </h2>
              <div className="space-y-2">
                <Label htmlFor="card-question">Pregunta de la ficha</Label>
                <textarea
                  id="card-question"
                  rows={3}
                  maxLength={4000}
                  value={question}
                  disabled={busy}
                  required
                  onChange={(event) => setQuestion(event.target.value)}
                  className="w-full rounded-lg border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="¿Qué concepto quieres recordar?"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="card-answer">Respuesta de referencia</Label>
                <textarea
                  id="card-answer"
                  rows={4}
                  maxLength={10000}
                  value={answer}
                  disabled={busy}
                  required
                  onChange={(event) => setAnswer(event.target.value)}
                  className="w-full rounded-lg border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Escribe una respuesta que puedas comprobar en el PDF"
                />
              </div>
              <div className="space-y-2">
                <Label>Vínculo con la fuente</Label>
                <ChoiceSelect
                  label="Tipo de fuente de la ficha"
                  value={sourceMode}
                  onValueChange={setSourceMode}
                  placeholder="Elige una fuente"
                  disabled={busy}
                  options={[
                    { value: "page", label: "Página de un PDF" },
                    {
                      value: "citation",
                      label: "Cita guardada en Laboratorio",
                    },
                  ]}
                />
              </div>
              {sourceMode === "page" ? (
                <>
                  <ChoiceSelect
                    label="PDF de la ficha"
                    value={documentId}
                    onValueChange={(value) => {
                      setDocumentId(value)
                      setPage("1")
                    }}
                    placeholder="Elige un PDF procesado"
                    disabled={busy}
                    options={(documents.data ?? [])
                      .filter(
                        (item) =>
                          item.current_version_id && sourceType(item) === "pdf",
                      )
                      .map((item) => ({ value: item.id, label: item.title }))}
                  />
                  <div className="space-y-2">
                    <Label htmlFor="card-page">Página de referencia</Label>
                    <Input
                      id="card-page"
                      type="number"
                      min={1}
                      max={document?.page_count ?? 1}
                      value={page}
                      onChange={(event) => setPage(event.target.value)}
                      disabled={busy}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Tu ficha es una nota manual vinculada a esta página. No se
                      presenta como una respuesta validada por IA.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <ChoiceSelect
                    label="Cita de la ficha"
                    value={citationKey}
                    onValueChange={(value) => {
                      setCitationKey(value)
                      const item = cited.find(([key]) => key === value)?.[1]
                      if (item && !answer.trim()) setAnswer(item.citation.text)
                    }}
                    placeholder="Elige una cita real"
                    disabled={busy}
                    options={cited.map(([key, item]) => ({
                      value: key,
                      label: `${item.title}: ${item.citation.document_title}, ${sourceLocation(item.citation)}, fuente ${item.citation.label}`,
                    }))}
                  />
                  {!cited.length && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Guarda una respuesta citada en Laboratorio para usarla
                      como fuente de estudio.
                    </p>
                  )}
                </>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !question.trim() ||
                    !answer.trim() ||
                    (sourceMode === "page"
                      ? !documentId ||
                        !Number.isInteger(Number(page)) ||
                        Number(page) < 1 ||
                        Number(page) > (document?.page_count ?? 0)
                      : !citationKey)
                  }
                >
                  <Plus size={15} />
                  {editingCard ? "Guardar cambios" : "Guardar ficha"}
                </Button>
                {editingCard && (
                  <Button type="button" variant="outline" onClick={resetCard}>
                    Cancelar
                  </Button>
                )}
              </div>
            </form>
          </details>
          <section className="min-w-0 space-y-4" aria-label="Fichas guardadas">
            <h2 className="text-lg font-semibold">{deck.name}</h2>
            {cards.data?.map((card) => (
              <article key={card.id} className="rounded-xl border p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="whitespace-pre-wrap break-words text-base font-semibold leading-7">
                    {card.question}
                  </h3>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Editar ficha ${card.question}`}
                      onClick={() => {
                        setEditingCard(card)
                        setQuestion(card.question)
                        setAnswer(card.answer)
                        setDocumentId(card.document_id ?? "")
                        setPage(String(card.page_number))
                        setCitationKey(
                          card.source_message_id
                            ? `${card.source_message_id}:${card.citation_label}`
                            : "",
                        )
                        setSourceMode(
                          card.source_message_id ? "citation" : "page",
                        )
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Eliminar ficha ${card.question}`}
                      onClick={() =>
                        setDeleting({
                          kind: "cards",
                          id: card.id,
                          title: card.question,
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                  {card.answer}
                </p>
                <CardSource card={card} workspaceId={workspace} />
                <p className="mt-3 text-xs text-muted-foreground">
                  {card.review_count} repasos · próximo:{" "}
                  {new Date(card.due_at).toLocaleString()}
                </p>
              </article>
            ))}
            {!cards.isPending && !cards.data?.length && (
              <p className="rounded-xl border border-dashed p-6 text-sm leading-6 text-muted-foreground">
                Escribe una pregunta y una respuesta breve. Vincúlala a un PDF
                para comprobarla cuando repases.
              </p>
            )}
          </section>
        </div>
      )}
      {section === "review" && deck && (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)]">
          <section className="min-w-0 space-y-5" aria-label="Sesión de repaso">
            <label
              htmlFor="study-review-all"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="study-review-all"
                checked={allCards}
                onCheckedChange={(value) => {
                  setAllCards(!!value)
                  setRevealed(false)
                  setResponse("")
                  setSelectedReviewCard("")
                }}
              />
              Incluir fichas programadas para después
            </label>
            {current ? (
              <article className="rounded-2xl border p-6 md:p-8">
                <p className="text-xs text-muted-foreground">
                  {queue.length} fichas en esta selección
                </p>
                <h2 className="mt-5 whitespace-pre-wrap break-words text-xl font-semibold leading-8">
                  {current.question}
                </h2>
                <div className="mt-6 space-y-2">
                  <Label htmlFor="review-answer">
                    Tu respuesta, antes de mirar
                  </Label>
                  <textarea
                    id="review-answer"
                    value={response}
                    rows={4}
                    maxLength={10000}
                    onChange={(event) => setResponse(event.target.value)}
                    disabled={busy || revealed}
                    className="w-full rounded-lg border bg-background p-3 text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Intenta recordar con tus palabras"
                  />
                </div>
                {!revealed ? (
                  <Button className="mt-5" onClick={() => setRevealed(true)}>
                    <BookOpen size={15} />
                    Mostrar respuesta
                  </Button>
                ) : (
                  <div className="mt-6 space-y-5 border-t pt-6">
                    <p className="whitespace-pre-wrap break-words text-sm leading-7">
                      {current.answer}
                    </p>
                    <CardSource card={current} workspaceId={workspace} />
                    <p className="text-sm text-muted-foreground">
                      ¿Cómo te fue? Esta valoración la eliges tú.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(ratingLabels).map(([value, label]) => (
                        <Button
                          key={value}
                          variant={value === "good" ? "default" : "outline"}
                          disabled={busy}
                          onClick={() => void rate(value)}
                        >
                          {value === "again" ? (
                            <RotateCcw size={14} />
                          ) : value === "good" ? (
                            <Check size={14} />
                          ) : null}
                          {label}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Otra vez: 10 minutos. Difícil: 1 día. Bien: 3 días. Fácil:
                      7 días.
                    </p>
                  </div>
                )}
              </article>
            ) : (
              <div className="rounded-2xl border border-dashed p-8">
                <h2 className="text-lg font-semibold">
                  {cards.data?.length
                    ? "Tus repasos están al día"
                    : "Este mazo aún no tiene fichas"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {cards.data?.length
                    ? "Vuelve en la próxima fecha o activa las fichas programadas para seguir practicando."
                    : "Crea fichas desde Estudio para empezar a practicar."}
                </p>
              </div>
            )}
          </section>
          <aside className="min-w-0 space-y-5">
            <h2 className="text-lg font-semibold">Tu progreso</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              Registro de tus repasos y valoraciones. No es una calificación
              automática de la precisión de tus respuestas.
            </p>
            {progress.data && (
              <dl className="divide-y text-sm">
                {[
                  ["Fichas del mazo", progress.data.cards],
                  ["Pendientes hoy", progress.data.due_cards],
                  ["Fichas repasadas", progress.data.reviewed_cards],
                  ["Repasos guardados", progress.data.reviews],
                  ...Object.entries(progress.data.ratings).map(
                    ([key, value]) => [ratingLabels[key], value],
                  ),
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="flex justify-between py-3"
                  >
                    <dt>{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Últimos repasos</h3>
              {reviews.data?.slice(0, 20).map((review) => (
                <details
                  key={review.id}
                  className="rounded-lg border p-3 text-xs"
                >
                  <summary className="cursor-pointer">
                    {ratingLabels[review.rating]} ·{" "}
                    {new Date(review.created_at).toLocaleString()}
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap leading-6">
                    {review.response ||
                      "No escribiste una respuesta en este repaso."}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    Próximo repaso:{" "}
                    {new Date(review.next_due_at).toLocaleString()}
                  </p>
                </details>
              ))}
              {!reviews.isPending && !reviews.data?.length && (
                <p className="text-sm text-muted-foreground">
                  Cuando valores una ficha, el repaso aparecerá aquí.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
      <ConfirmationDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
        title={deleting?.kind === "decks" ? "Eliminar mazo" : "Eliminar ficha"}
        description={
          deleting?.kind === "decks"
            ? "Se eliminarán el mazo, sus fichas y sus repasos. Los PDFs permanecen en tu biblioteca."
            : "Se eliminarán la ficha y sus repasos. Su PDF permanece en tu biblioteca."
        }
        confirmLabel="Eliminar"
        pending={busy}
        onConfirm={async () => {
          if (!deleting) return
          setBusy(true)
          try {
            await learningRequest(`/${deleting.kind}/${deleting.id}`, "DELETE")
            if (editingCard?.id === deleting.id || deckId === deleting.id)
              resetCard()
            if (editingDeck?.id === deleting.id) {
              setEditingDeck(undefined)
              setDeckName("")
              setDeckDescription("")
            }
            setDeleting(undefined)
            await refresh()
          } catch (failure) {
            setError(errorMessage(failure))
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function CardSource({
  card,
  workspaceId,
}: {
  card: Card
  workspaceId: string
}) {
  const evidences = card.evidences?.length
    ? card.evidences
    : card.evidence
      ? [card.evidence]
      : []
  return (
    <div className="mt-4 space-y-2">
      <Badge variant="outline">
        {evidences.length
          ? `${evidences.length} ${evidences.length === 1 ? "cita documental" : "citas documentales"}`
          : card.citation_label
            ? "Cita original no disponible"
            : "Referencia manual"}
      </Badge>
      {evidences.length ? (
        <SourceReferences citations={evidences} workspaceId={workspaceId} />
      ) : card.source_available && card.document_id ? (
        <a
          className="block text-xs leading-5 text-primary underline underline-offset-4"
          href={`${apiRoot}/documents/${card.document_id}/file#page=${card.page_number}`}
          target="_blank"
          rel="noreferrer"
        >
          {card.source_title}, página {card.page_number}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          La fuente original ya no está disponible. La ficha conserva tu
          contenido.
        </p>
      )}
    </div>
  )
}
