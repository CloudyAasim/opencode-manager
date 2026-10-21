/**
 * The shell's own "which server?" dialog.
 *
 * Electron has no text-input dialog on Windows - `dialog.showMessageBox` can
 * only offer buttons - so the client shows a window of its own. It is a
 * `data:` URL rather than a file, because a window that has to be opened
 * before anybody is signed in cannot be a page of the app: the app is served
 * by a proxy that may itself be pointing at the wrong server.
 *
 * The dialog does not talk to the network at all. It talks to the main
 * process through the same preload bridge the app uses, which is the only
 * thing it is allowed to do.
 */

/** Escape a value for an HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The dialog's document.
 *
 * Kept as a function of the current target so the dialog opens with the
 * address already in it: a person changing the server usually wants to edit
 * the one they have, not to type it from scratch.
 */
export function serverDialogHtml(currentTarget: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OpenCode Manager - server</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #09090b; color: #fafafa;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
  p { font-size: 12px; color: #a1a1aa; margin: 0 0 16px; }
  input {
    width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: inherit; background: #18181b;
    border: 1px solid #3f3f46; border-radius: 6px;
  }
  input:focus { outline: 2px solid #3b82f6; outline-offset: -1px; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  button {
    padding: 6px 14px; font-size: 13px; border-radius: 6px; cursor: pointer;
    border: 1px solid #3f3f46; background: #27272a; color: inherit;
  }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  #error { color: #f87171; font-size: 12px; margin-top: 10px; min-height: 1em; }
</style>
</head>
<body>
<h1>Which server should this client talk to?</h1>
<p>The address is kept by the client. It decides where the app's requests go.</p>
<form id="form">
  <input id="address" name="address" spellcheck="false" autocomplete="off"
         placeholder="code.example.com" value="${escapeAttribute(currentTarget)}">
  <div id="error" role="alert"></div>
  <div class="row">
    <button type="button" id="cancel">Cancel</button>
    <button type="submit" id="save" class="primary">Save</button>
  </div>
</form>
<script>
  var form = document.getElementById('form')
  var input = document.getElementById('address')
  var error = document.getElementById('error')
  var save = document.getElementById('save')

  document.getElementById('cancel').addEventListener('click', function () { window.close() })

  form.addEventListener('submit', function (event) {
    event.preventDefault()
    error.textContent = ''
    save.disabled = true
    Promise.resolve(window.ocmHost.setTarget(input.value)).then(function (result) {
      if (result && result.ok) {
        window.close()
        return
      }
      save.disabled = false
      error.textContent = (result && result.error) ? String(result.error) : 'The address was refused.'
    }, function (failure) {
      save.disabled = false
      error.textContent = String(failure)
    })
  })

  input.focus()
  input.select()
</script>
</body>
</html>`
}

/**
 * The dialog's window options.
 *
 * The same sandbox as the app window: the dialog reads a server address and
 * hands it to the main process. It has no business with Node, and a page that
 * has no business with Node is a page that cannot be talked into having one.
 *
 * The preload path is passed in rather than resolved here: this file is
 * bundled next to `preload.js`, and the caller is the one that knows where
 * the bundle ended up.
 */
export function serverDialogOptions(preloadPath: string): {
  width: number
  height: number
  resizable: boolean
  minimizable: boolean
  maximizable: boolean
  alwaysOnTop: boolean
  title: string
  backgroundColor: string
  show: boolean
  webPreferences: {
    contextIsolation: true
    nodeIntegration: false
    sandbox: true
    webSecurity: true
    preload: string
  }
} {
  return {
    width: 520,
    height: 260,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    title: 'OpenCode Manager',
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // The same preload the app window uses: the dialog's only way out is
      // the same bridge the app already has.
      preload: preloadPath,
    },
  }
}
