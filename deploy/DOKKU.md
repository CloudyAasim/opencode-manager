# Dokku deployment runbook

How this fork is actually deployed, and what an operator has to know that is not
in the repository.

> **Rewritten 2026-10-05.** The previous version carried a "partially outdated"
> banner but still told the reader to run
> `gh workflow run dokku-diagnostics.yml` (that workflow was deleted) and that
> the deploy workflow applies `checks:disable` and the storage mounts (it stopped
> doing both in `2bf0b2a`). Everything below is what runs today.

## What a release actually does

`.github/workflows/deploy.yml` builds the frontend, asks `dokku/github-action` to
push to the **`server`** branch on the host, and then checks that the public site
is serving what it just deployed. Dokku builds the image, runs the health checks
and swaps the container.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0          # Dokku builds from the full history
- run: pnpm --filter frontend build
                           # what the site is supposed to end up serving
- uses: dokku/github-action@<pinned sha>
  with:
    git_remote_url: ${{ secrets.GIT_REMOTE_URL }}
    ssh_private_key: ${{ secrets.SSH_PRIVATE_KEY }}
    branch: server
- run: node scripts/verify-production-deploy.mjs ...
                           # that the site is serving it
```

Pushing to `main` triggers this, and `gh workflow run deploy.yml` runs it again
without a commit. The last step is the one that makes the run mean something:
the push can succeed while the site still serves the previous build, and the
health check cannot tell the two apart. See **What "deployed successfully" means**
below.

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

### The host is small, and that changes how a deploy behaves

The machine this app is deployed on has **3.9 GB of RAM, no swap at all, and
nine other applications on it** (a relay, a search service, a form app, a
PMA, a share service, a p2p sender and others). When the apps are running,
about 1.9 GB of that memory is in use and about 2 GB is available.

That is the whole context for a deploy here, because **the image is built on
this host**. Measured on Linux, the frontend build peaks at **1830 MB** of
process memory, of which the V8 heap itself wants 1.0-1.3 GB. That leaves
about 165 MB of headroom against the host's 1995 MB, and with no swap there
is no buffer at all.

What that cost, on 2026-10-20:

- The build started at 06:50 and the site stopped answering at 06:57, and
  kept not answering for **25 minutes**. The container was never reported
  dead - it was starved, not killed.
- The host rebooted at **07:14:17** (twice independently measured from
  `/proc/uptime`, and it matches the Dokku event listener reconnecting to
  Docker at 07:19:57 and re-registering all ten containers at 07:20:12).
  The build died with it (`exit_code: -1`, "the remote end hung up
  unexpectedly") and the deploy failed.
- The site came back on the **old** build: the deploy had failed, so nothing
  new was ever deployed.

**The reboot's cause is not established.** Linux's OOM killer kills processes;
it does not reboot machines. Reading the kernel log needs root on the host,
which this repository does not have. One command settles it:

```shell
sudo journalctl -k --since "2026-10-20 06:50" --until "2026-10-20 07:20" \
  | grep -iE "oom|killed process|out of memory"
```

The build is now capped at **1536 MB** of heap in the Dockerfile, in CI and
in the deploy workflow. That is the smallest cap the build passes reliably
(768 MB always fails, 1024 MB fails about one build in three), and CI builds
with the same cap so a cap that is too small shows up there rather than here.
A build that does not fit now fails the deploy and leaves the running service
alone, which is the outcome worth having.

### The accepted risk

**As of 2026-10-20 the owner decided to keep the current setup**: no swap on
the host, and the image is still built on the host rather than in CI. Both
options were priced out and deliberately declined, so the numbers below are
what is being accepted, not an oversight:

- **Every change to `frontend/src` or `shared/src` makes the host absorb a
  ~1830 MB, ~90 second memory spike**, with roughly 165 MB of headroom and
  no swap to absorb the overflow. With a build cache warm only the frontend
  compile re-runs; a change to a `package.json` re-runs the whole install
  as well, and that is the case that took the site down.
- The mitigations that are in place: the heap cap (above), and the deploy's
  last step, which checks that the public site is actually serving the build
  that was just deployed - so a failed or partial deploy cannot pass
  unnoticed.

The two ways this risk would be removed, for whoever picks it up later:

1. **Add swap to the host.** 2 GB, sized to the build's measured peak rather
   than by rule of thumb: `fallocate -l 2G /swapfile`, `chmod 600`,
   `mkswap`, `swapon`, and a `/etc/fstab` entry (this host reboots, so
   without the entry the swap is gone after the next one). Needs root.
2. **Stop building on this host.** The image is already built in CI by
   `.github/workflows/docker-build.yml` and pushed to GHCR, and
   `dokku/github-action` can deploy an image instead of pushing a branch
   (`deploy_docker_image`, which becomes `dokku git:from-image <app> <image>`
   on the host). That removes the build from the host entirely, so a deploy
   can never take the running service down. It needs the GHCR package to be
   pullable by the host, and it needs the old images to be pruned - the host
   has 9.8 GB of disk free.

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

# Application health - is it up?
curl -s https://APP_DOMAIN/api/health
```

### What "deployed successfully" means

**Not the health check.** `/api/health` says the service is up; it does not
say *which* version is up. `opencodeManagerVersion` in that payload is the
version in `package.json`, and it is the same before and after a release, so
it cannot tell you whether the site is serving the commit you just pushed.

This is not theoretical. On 2026-10-20 a deploy failed on the host while the
old container went on serving traffic: the site was healthy, the deploy was
red, and users were on the old code until someone noticed.

So the deploy workflow ends with a check that compares the assets the site
serves against the ones this commit's build produced:

```shell
# The site's own entry point names the bundle it serves
curl -s https://APP_DOMAIN/ | grep -o 'main-[A-Za-z0-9_-]*\.js'
```

The bundle's name is a content hash, so that name identifies the build
exactly. The workflow does this comparison itself, in the
**Confirm the site is serving this build** step, and fails the run if the
site is not serving the build that was just deployed.

The address is read from the `PRODUCTION_URL` repository variable, and
defaults to this fork's own domain when that variable is not set — a check
that has to be switched on by hand is a check that silently does nothing.

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
