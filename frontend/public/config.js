// Runtime configuration for this deployment.
//
// This file is served as-is, ahead of the bundle, and it is the one thing a
// self-hoster edits to point a build at their own server. `serverUrl` is
// resolved against everything else the person can choose; leaving it empty
// means "the origin this page was served from", which is what a deployment
// behind its own reverse proxy wants.
//
// Docker users can regenerate it from an environment variable instead of
// editing in place - see the note in the Dockerfile's runtime stage.
//
// Examples:
//   window.__OCM_RUNTIME_CONFIG__ = { serverUrl: "https://code.example.com" }
//   window.__OCM_RUNTIME_CONFIG__ = { serverUrl: "http://192.168.1.10:5003" }
//   window.__OCM_RUNTIME_CONFIG__ = { serverUrl: "https://host.example.com/manager" }
window.__OCM_RUNTIME_CONFIG__ = window.__OCM_RUNTIME_CONFIG__ || {};