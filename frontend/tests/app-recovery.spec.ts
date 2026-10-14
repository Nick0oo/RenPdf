import { expect, test } from "@playwright/test"

const api = "http://localhost:8000/api/v1"

test("a failed chat asset can be recovered without losing the session", async ({
  page,
  context,
}) => {
  const name = `Recuperación de pantalla ${Date.now()}`
  const response = await page.request.post(`${api}/workspaces/`, {
    data: { name },
  })
  expect(response.ok()).toBeTruthy()
  const workspace = await response.json()
  let requests = 0
  try {
    await page.goto("/")
    await page.evaluate((id) => {
      localStorage.setItem("renpdf_workspace", id)
    }, workspace.id)
    await page.route("**/*WorkspaceDesk*", async (route) => {
      requests += 1
      if (requests === 1) await route.abort("failed")
      else await route.continue()
    })
    await page.reload()
    await expect
      .poll(async () =>
        Boolean(
          (await page.getByTestId("error-component").count()) ||
            (await page.getByRole("heading", { name, exact: true }).count()),
        ),
      )
      .toBe(true)
    // Dev imports surface the boundary; production Vite reloads automatically.
    if (await page.getByTestId("error-component").count())
      await page
        .getByRole("button", { name: "Recargar aplicación", exact: true })
        .click()
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    await expect(page.getByTestId("error-component")).toHaveCount(0)
    expect(requests).toBeGreaterThanOrEqual(2)
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === "renpdf_session" && cookie.httpOnly,
      ),
    ).toBe(true)
    expect(
      await page.evaluate(() => localStorage.getItem("access_token")),
    ).toBeNull()
  } finally {
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
  }
})

test("an unavailable chat asset does not cause an endless reload", async ({
  page,
}) => {
  const response = await page.request.post(`${api}/workspaces/`, {
    data: { name: `Biblioteca recuperable ${Date.now()}` },
  })
  expect(response.ok()).toBeTruthy()
  const workspace = await response.json()
  let requests = 0
  let navigations = 0
  try {
    await page.goto("/")
    const compiled = await page.evaluate(() => {
      const entry = document.querySelector<HTMLScriptElement>(
        'script[type="module"][src]',
      )?.src
      return !!entry && new URL(entry).pathname.startsWith("/assets/")
    })
    await page.evaluate((id) => {
      localStorage.setItem("renpdf_workspace", id)
    }, workspace.id)
    await page.route("**/*WorkspaceDesk*", async (route) => {
      requests += 1
      await route.abort("failed")
    })
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations += 1
    })
    await page.reload()
    await expect(page.getByTestId("error-component")).toBeVisible()
    // Count full page loads, not preload/import requests for the same asset.
    // Production recovers once; dev imports go directly to the recovery UI.
    await expect.poll(() => navigations).toBe(compiled ? 2 : 1)
    const recoveryMarkers = await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith("renpdf_asset_reload:"))
        .map((key) => sessionStorage.getItem(key)),
    )
    expect(recoveryMarkers).toEqual(compiled ? ["1"] : [])
    const failedRequests = requests
    const settledNavigations = navigations
    // A permanently missing chunk should settle on the explicit recovery UI.
    await page.waitForTimeout(1000)
    expect(requests).toBe(failedRequests)
    expect(navigations).toBe(settledNavigations)
    await page
      .getByRole("button", { name: "Abrir biblioteca", exact: true })
      .click()
    await expect(page.getByTestId("error-component")).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("renpdf_workspace")))
      .toBeNull()
    expect((await page.request.get(`${api}/users/me`)).ok()).toBeTruthy()
  } finally {
    await page.request.delete(`${api}/workspaces/${workspace.id}`)
  }
})

test("an expired session hint returns to a usable login", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL!).origin,
          localStorage: [{ name: "renpdf_signed_in", value: "1" }],
        },
      ],
    },
  })
  try {
    const page = await context.newPage()
    await page.goto(`${baseURL}/login`)
    await expect(page.getByTestId("email-input")).toBeVisible()
    await expect(page.getByTestId("password-input")).toBeVisible()
    await expect(page.getByTestId("error-component")).toHaveCount(0)
    expect(
      await page.evaluate(() => localStorage.getItem("renpdf_signed_in")),
    ).toBeNull()
  } finally {
    await context.close()
  }
})
