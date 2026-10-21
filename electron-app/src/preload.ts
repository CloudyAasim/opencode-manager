/**
 * Preload. The only bridge between the renderer and the main process.
 *
 * Deliberately tiny: the renderer needs to know which server the proxy is
 * pointed at, it needs to be able to point it somewhere else, and it needs to
 * be able to ask the shell for its own "which server?" dialog. Anything else
 * writable from here is something a compromised page could invoke.
 *
 * The bridge is called `ocmHost` rather than after one platform, because the
 * page is the same bundle in every shell and the contract is the same in
 * every shell: the shell owns the server address, and the page asks.
 */
import { contextBridge, ipcRenderer } from 'electron'

export type DesktopInfo = {
  target: string
  proxyOrigin: string
  version: string
}

contextBridge.exposeInMainWorld('ocmHost', {
  info: (): Promise<DesktopInfo> => ipcRenderer.invoke('ocm:info'),
  setTarget: (target: string): Promise<{ ok: boolean; target?: string; error?: string }> =>
    ipcRenderer.invoke('ocm:set-target', target),
  changeServer: (): Promise<void> => ipcRenderer.invoke('ocm:change-server'),
})
