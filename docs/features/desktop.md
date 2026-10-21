# Windows Desktop Client

A window around your own OpenCode Manager server.

The client is a shell, not a second implementation: it serves the same web app
the browser gets and forwards its requests to the server you name. Nothing
about a conversation, a repository or a schedule is decided on the client.

## Why there is a proxy in the middle

Pointing a desktop client straight at a remote server does not work, and it
fails in a way that says nothing about why:

- The session cookie is `SameSite=Lax`, so a cross-site request does not carry
  it. The request passes the CORS layer and comes back `401`.
- The server refuses the origin itself - there are two layers of that, both on
  the server side.

So the client runs a small proxy on `127.0.0.1` and serves the app from
there. The browser sees one origin, the cookie travels, and the server sees an
ordinary request.

## Choosing a server

The client remembers the server, and it is the only thing that may change it:

- The sign-in page has a **Change server** button, which opens the client's own
  dialog.
- Settings -> Server Address shows the same address and saves it to the client.

Either way the address is kept by the client, not by the page. That is not a
detail: a page that pointed itself at a remote origin would drop the session
cookie again, which is the failure this whole arrangement exists to avoid.

The client's settings live next to the app's own data
(`%APPDATA%\OpenCode Manager\client.json`).

## The first launch

If the client cannot find a server, it still starts: the window opens and the
sign-in page offers to name one. That is deliberate - "the server is not
running yet" should not look like "the client is broken".

To point it at a server from the start:

```powershell
$env:OCM_SERVER_URL = 'https://code.example.com'
```

## Installing

Two builds are produced:

| Build | What it is |
|---|---|
| **NSIS installer** | The normal one. Installs the client and a shortcut. |
| **Portable** | One file. Run it from a stick; nothing is installed. |

Both are **unsigned**, so Windows shows its "unknown publisher" warning.
Signing needs a certificate, and a certificate needs somewhere to live and
something to rotate it - that is its own piece of work, and it comes before
automatic updates (an update feed that can be replaced is worse than no
updates).

## What the client is not

- It is not a server. It does not install, update or supervise OpenCode
  Manager.
- It is not a second front end. The window is the same web app.
- It does not keep your session in a place of its own. The session belongs to
  the server, and signing out signs you out there too.

## For developers

```powershell
# the client, from the repository
cd electron-app
npm install
npm run build
npm start           # builds and opens the window

# the tests (no Electron binary needed)
npm test

# the installers
npm run package     # writes release/
```

The Electron binary is deliberately not part of the repository's lockfile: it
is 266 MB unpacked, and a server that never loads a desktop runtime should not
download one on every build. This package therefore has its own lockfile and
is not a workspace member; the CI job that runs these tests installs with
`--ignore-scripts`, so the binary is never downloaded there.

The design, and the measurements behind it, are in the project's handover
notes.
