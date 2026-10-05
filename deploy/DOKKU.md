# Dokku deployment runbook

How this fork is actually deployed, and what an operator has to know that is not
in the repository.

> **Rewritten 2026-10-05.** The previous version carried a "partially outdated"
> banner but still told the reader to run
> `gh workflow run dokku-diagnostics.yml` (that workflow was deleted) and that
> the deploy workflow applies `checks:disable` and the storage mounts (it stopped
> doing both in `2bf0b2a`). Everything below is what runs today.

## What a release actually does

`.github/workflows/deploy.yml` is now five meaningful lines: it checks out the
full history and asks `dokku/github-action` to push to the **`server`** branch on
the host. Dokku builds the image, runs the health checks and swaps the container.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0          # Dokku builds from the full history
- uses: dokku/github-action@<pinned sha>
  with:
    git_remote_url: ${{ secrets.GIT_REMOTE_URL }}
    ssh_private_key: ${{ secrets.SSH_PRIVATE_KEY }}
    branch: server
```

Pushing to `main` triggers this. There are no other configuration steps left in
the workflow.

The action is pinned to a commit rather than `@master`, because this is the one
step that receives the production deploy key on every push. See the comment in
the workflow for the SHA and why it is not the `v1.10.0` tag.

## What the server owns

Since `2bf0b2a` ("hand the Dokku configuration over to the server") the repository
no longer declares any of this. Dokku persists it on the host, and **the only way
to know it is to ask the host.** Every value below is a server-side setting with
no repository equivalent:

| Setting | How to inspect |
| --- | --- |
| Environment (`OCM_*`, `AUTH_*`, secrets) | `dokku config:show opencode-manager` |
| Domains and TLS | `dokku domains:list opencode-manager`, `dokku certs:report opencode-manager --ssl-enabled` |
| Port map | `dokku ports:show opencode-manager` |
| Storage mounts | `docker inspect opencode-manager.web.1 --format '{{json .Mounts}}'` |
| Zero-downtime checks | `dokku checks:list opencode-manager` |
| Container security options | `docker inspect opencode-manager.web.1 --format '{{json .HostConfig.SecurityOpt}}'` |

`dokku config:show` is the single most useful command here: it settles any
question about `OCM_TERMINAL_*` that the documentation used to answer wrongly.
Do not trust a document over it.

### Required for the terminal sandbox: `seccomp=unconfined`

The web terminal gives non-admins a confined shell, built as
`unshare --user --map-root-user --mount --propagation unchanged` plus a chroot.
The container runs as `USER node`, and a non-root process has neither
`CAP_SYS_CHROOT` nor `CAP_SYS_ADMIN` — the user namespace is the only way to get
them. Docker's default seccomp profile blocks `clone(CLONE_NEWUSER)`, so without
this option the sandbox cannot be built and **non-admin terminals are refused**
(fail-closed: admins are unaffected, and nothing ever degrades to an unconfined
shell).

```shell
dokku docker-options:add opencode-manager deploy "--security-opt seccomp=unconfined"
dokku docker-options:add opencode-manager run     "--security-opt seccomp=unconfined"
dokku ps:restart opencode-manager     # options apply to newly created containers
```

Nothing in the repository performs this. It was in the deploy workflow until
`2bf0b2a` removed it, and the sandbox has been unbuildable since that day.

**AppArmor does not need changing.** The common belief that "if it is AppArmor,
relaxing seccomp will not help" is true of the *old* probe, which omitted
`--propagation unchanged` and therefore made `unshare --mount` attempt a mount
propagation change that the `docker-default` profile blocks. The production argv
passes `--propagation unchanged` and never makes that change, so seccomp is the
only blocker.

Verify on the host — the probe must match the production argv exactly, or it
gives a false negative:

```shell
docker exec opencode-manager.web.1 \
  unshare --user --map-root-user --mount --propagation unchanged true \
  && echo SANDBOX_OK || echo SANDBOX_BLOCKED
```

And check the boundary actually holds:

```shell
# uid=0(root), as designed: the uid mapping is what confines the writes
docker exec opencode-manager.web.1 \
  unshare --user --map-root-user --mount --propagation unchanged -- \
  /bin/sh /app/backend/scripts/terminal-sandbox.sh /usr/bin/id /workspace /workspace

# /app must be unreachable
docker exec opencode-manager.web.1 \
  unshare --user --map-root-user --mount --propagation unchanged -- \
  /bin/sh /app/backend/scripts/terminal-sandbox.sh /bin/ls /workspace /workspace /app
```

`terminal-sandbox.sh` takes `<shell> <workspace> <sandbox-cwd> [shell-args...]`.
Called with fewer arguments it exits 64 with a usage message.

## Operating

```shell
# Redeploy the current main
gh workflow run deploy.yml

# Follow the run
gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# Application health (this is what "deployed successfully" means)
curl -s https://APP_DOMAIN/api/health
```

There is no diagnostics workflow. To inspect the host, use the `docker inspect`
and `dokku config:show` commands in the table above.

## Rolling back

**This procedure is not written down anywhere else in the repository, and the
native Dokku command is deliberately not quoted here** — its exact syntax
depends on the installed Dokku version. Check it on the host:

```shell
dokku help | grep -i rollback
```

The mechanism that does not depend on that is to re-point the `server` branch at
the last known-good commit, because pushing to it is the entire deployment
action:

1. Identify the last good commit (`git log --oneline` on `main`, cross-check
   against the deploy runs in the Actions UI).
2. Back up the data first (see below) — a rollback only helps if the schema
   involved is reversible.
3. Force the `server` branch to that commit on the host and let Dokku rebuild.

Rolling back code does **not** roll back a database migration. If the bad release
ran a migration, restoring the previous image against the new schema may not be
enough.

## Backups

**There is no backup script for this deployment.** Everything under `deploy/`
(`backup.sh`, `restore.sh`, `install.sh`, `update.sh`) drives
`docker compose -f docker-compose.prod.yml` and targets the VPS + Caddy path
documented in `docs/cloud/deployment.md`. None of it works on Dokku, which
manages its own containers and has no compose project.

For this host, a backup is a snapshot of the two storage directories that
`docker inspect --format '{{json .Mounts}}'` reports — the SQLite database under
`/app/data` and the user workspaces under `/workspace`. **Confirm the host paths
before scripting anything**, then stop the app (or use SQLite's online backup)
before copying the database file.

This is a known gap, not a documented procedure. Until it is closed, do not
treat `deploy/backup.sh` as this deployment's backup.
