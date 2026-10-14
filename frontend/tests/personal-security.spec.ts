import { expect, test } from "@playwright/test"

test("session uses HttpOnly cookie and no browser token", async ({
  page,
  context,
}) => {
  await page.goto("/")
  expect(
    (await context.cookies()).find((cookie) => cookie.name === "renpdf_session")
      ?.httpOnly,
  ).toBe(true)
  expect(
    await page.evaluate(() => localStorage.getItem("access_token")),
  ).toBeNull()
})

test("public registration has no active UI", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  })
  const page = await context.newPage()
  await page.goto(
    `${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173"}/signup`,
  )
  await expect(page).toHaveURL(/\/login$/)
  await context.close()
})
