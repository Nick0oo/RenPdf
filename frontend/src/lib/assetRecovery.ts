/** Recover an open tab once when a deployment replaces a lazily loaded asset. */
export function installAssetRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    const entry = document.querySelector<HTMLScriptElement>(
      'script[type="module"][src]',
    )?.src
    const key = `renpdf_asset_reload:${entry ?? window.location.pathname}`

    try {
      // Persist before reloading. A permanently unavailable asset must not loop.
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, "1")
    } catch {
      // If browser storage is unavailable, keep the explicit recovery screen.
      return
    }

    event.preventDefault()
    window.location.reload()
  })
}
