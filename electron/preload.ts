import { ipcRenderer, contextBridge } from 'electron'

const listeners = new WeakMap<Function, (event: any, ...args: any[]) => void>()

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    const wrapper = (event: any, ...args: any[]) => listener(event, ...args)
    listeners.set(listener, wrapper)
    return ipcRenderer.on(channel, wrapper)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args
    const wrapper = listeners.get(listener)
    if (wrapper) {
      listeners.delete(listener)
      return ipcRenderer.off(channel, wrapper)
    }
    return ipcRenderer
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})
