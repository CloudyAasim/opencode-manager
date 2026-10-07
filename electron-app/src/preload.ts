/**
 * Preload. The only bridge between the renderer and the main process.
 *
 * Deliberately tiny and read-only: the renderer needs to know which server the
 * proxy is pointed at so the settings screen can show it, and nothing else.
 * Anything writable from here is something a compromised page could invoke.
 */
import { contextBridge, ipcRenderer } from 'electron'

export type DesktopInfo = {
  target: string
  proxyOrigin: string
  version: string
}

contextBridge.exposeInMainWorld('ocmDesktop', {
  info: (): Promise<DesktopInfo> => ipcRenderer.invoke('ocm:info'),
  setTarget: (target: string): Promise<{ ok: boolean; target?: string; error?: string }> =>
    ipcRenderer.invoke('ocm:set-target', target),
})