import { RequestArguments } from 'common/typedefs/ipcBridge'
import { JsonRpcCallback } from 'common/types'
import { contextBridge, ipcRenderer, webFrame } from 'electron'

/**
 * @dev Extension must be removed prior to loading a page with this preload script.
 * Otherwise window.ethereum in the MM content script will replace the window.ethereum exposed here
 */
interface onEventsEnabledMap {
  [key: string]: boolean
}

const onEventsEnabled: onEventsEnabledMap = {}

const enabledTopics = [
  'accountsChanged',
  'connect',
  'message',
  'disconnect',
  'chainChanged',
  'close',
  // deprecated
  'networkChanged'
]

/* eslint-disable @typescript-eslint/no-explicit-any */
const listenToRendererCalls = (fxn: string, topic: string, cb: any) => {
  if (!enabledTopics.includes(topic)) {
    throw `Tried to listen to ${topic} through window.ethereum!`
  }
  if (!onEventsEnabled[topic]) {
    ipcRenderer.send('enableOnEvents', topic)
    onEventsEnabled[topic] = true
  }
  ipcRenderer[fxn]('providerApi' + topic, (ev: any, ...args: any[]) => {
    cb(...args)
  })
}

const provRequest = async (args: RequestArguments) => {
  const x = await ipcRenderer.invoke('providerRequest', args)
  if (
    x !== null &&
    x !== 'undefined' &&
    typeof x === 'object' &&
    Object.hasOwn(x, 'data') &&
    Object.hasOwn(x.data, 'originalError')
  ) {
    throw x.data.originalError
  }
  return x
}

const sendRequest = async (...args: unknown[]) => {
  // send method return is unknown https://eips.ethereum.org/EIPS/eip-1193#send-deprecated
  return ipcRenderer.invoke('sendRequest', args) as unknown
}

const sendAsyncRequest = async (payload: any, callback: JsonRpcCallback) => {
  const x = await ipcRenderer.invoke('sendAsyncRequest', payload, callback)
  return x
}

const providerApi = {
  provider: {
    request: async (args: RequestArguments) => {
      return provRequest(args)
    },
    send: async (...args: unknown[]) => {
      return sendRequest(...args)
    },
    sendAsync: async (payload: any, callback: JsonRpcCallback) => {
      return sendAsyncRequest(payload, callback)
    },
    once: (topic: string, cb: any) => {
      listenToRendererCalls('once', topic, cb)
    },
    on: (topic: string, cb: any) => {
      listenToRendererCalls('on', topic, cb)
    },
    off: (topic: string, cb: any) => {
      ipcRenderer.off('providerApi' + topic, cb)
    },
    addListener: (topic: string, cb: any) => {
      listenToRendererCalls('addListener', topic, cb)
    },
    removeListener: (topic: string, cb: any) => {
      ipcRenderer.removeListener('providerApi' + topic, cb)
    },
    removeAllListeners: (topic: string) => {
      ipcRenderer.removeAllListeners('providerApi' + topic)
    },
    enable: async () => {
      const args: RequestArguments = {
        method: 'eth_requestAccounts'
      }
      return provRequest(args)
    }
  }
}

contextBridge?.exposeInMainWorld('providerApi', providerApi)

function initProvider() {
  async function exposeWindowEthereum() {
    console.log('exposing window ethereum')
    if (!Object.hasOwn(window, 'ethereum')) {
      const windowAny = window as any
      windowAny.ethereum = {
        request: windowAny.providerApi.provider.request,
        send: windowAny.providerApi.provider.send,
        sendAsync: windowAny.providerApi.provider.sendAsync,
        once: windowAny.providerApi.provider.once,
        on: windowAny.providerApi.provider.on,
        off: windowAny.providerApi.provider.off,
        addListener: windowAny.providerApi.provider.addListener,
        removeListener: windowAny.providerApi.provider.removeListener,
        removeAllListeners: windowAny.providerApi.provider.removeAllListeners,
        isMetaMask: true,
        enable: windowAny.providerApi.provider.enable,
        selectedAddress: undefined,
        accounts: undefined
      }

      windowAny.ethereum.on('accountsChanged', (accounts: string[]) => {
        console.log('accounts changed', accounts)
        windowAny.ethereum.selectedAddress = accounts[0]
        windowAny.ethereum.accounts = accounts
      })

      const acct = await windowAny.ethereum.request({ method: 'eth_accounts' })
      windowAny.ethereum.selectedAddress =
        acct && acct.length > 0 ? acct[0] : ''
      windowAny.ethereum.accounts = acct
    }
  }

  exposeWindowEthereum()

  async function announceProvider() {
    const info = {
      uuid: '247e2951-1f19-4936-bd98-d0abe3f85dc9',
      name: 'MetaMask',
      icon: 'data:image/svg+xml;base64,PHN2ZyBmaWxsPSJub25lIiBoZWlnaHQ9IjMzIiB2aWV3Qm94PSIwIDAgMzUgMzMiIHdpZHRoPSIzNSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHN0cm9rZS13aWR0aD0iLjI1Ij48cGF0aCBkPSJtMzIuOTU4MiAxLTEzLjEzNDEgOS43MTgzIDIuNDQyNC01LjcyNzMxeiIgZmlsbD0iI2UxNzcyNiIgc3Ryb2tlPSIjZTE3NzI2Ii8+PGcgZmlsbD0iI2UyNzYyNSIgc3Ryb2tlPSIjZTI3NjI1Ij48cGF0aCBkPSJtMi42NjI5NiAxIDEzLjAxNzE0IDkuODA5LTIuMzI1NC01LjgxODAyeiIvPjxwYXRoIGQ9Im0yOC4yMjk1IDIzLjUzMzUtMy40OTQ3IDUuMzM4NiA3LjQ4MjkgMi4wNjAzIDIuMTQzNi03LjI4MjN6Ii8+PHBhdGggZD0ibTEuMjcyODEgMjMuNjUwMSAyLjEzMDU1IDcuMjgyMyA3LjQ2OTk0LTIuMDYwMy0zLjQ4MTY2LTUuMzM4NnoiLz48cGF0aCBkPSJtMTAuNDcwNiAxNC41MTQ5LTIuMDc4NiAzLjEzNTggNy40MDUuMzM2OS0uMjQ2OS03Ljk2OXoiLz48cGF0aCBkPSJtMjUuMTUwNSAxNC41MTQ5LTUuMTU3NS00LjU4NzA0LS4xNjg4IDguMDU5NzQgNy40MDQ5LS4zMzY5eiIvPjxwYXRoIGQ9Im0xMC44NzMzIDI4Ljg3MjEgNC40ODE5LTIuMTYzOS0zLjg1ODMtMy4wMDYyeiIvPjxwYXRoIGQ9Im0yMC4yNjU5IDI2LjcwODIgNC40Njg5IDIuMTYzOS0uNjEwNS01LjE3MDF6Ii8+PC9nPjxwYXRoIGQ9Im0yNC43MzQ4IDI4Ljg3MjEtNC40NjktMi4xNjM5LjM2MzggMi45MDI1LS4wMzkgMS4yMzF6IiBmaWxsPSIjZDViZmIyIiBzdHJva2U9IiNkNWJmYjIiLz48cGF0aCBkPSJtMTAuODczMiAyOC44NzIxIDQuMTU3MiAxLjk2OTYtLjAyNi0xLjIzMS4zNTA4LTIuOTAyNXoiIGZpbGw9IiNkNWJmYjIiIHN0cm9rZT0iI2Q1YmZiMiIvPjxwYXRoIGQ9Im0xNS4xMDg0IDIxLjc4NDItMy43MTU1LTEuMDg4NCAyLjYyNDMtMS4yMDUxeiIgZmlsbD0iIzIzMzQ0NyIgc3Ryb2tlPSIjMjMzNDQ3Ii8+PHBhdGggZD0ibTIwLjUxMjYgMjEuNzg0MiAxLjA5MTMtMi4yOTM1IDIuNjM3MiAxLjIwNTF6IiBmaWxsPSIjMjMzNDQ3IiBzdHJva2U9IiMyMzM0NDciLz48cGF0aCBkPSJtMTAuODczMyAyOC44NzIxLjY0OTUtNS4zMzg2LTQuMTMxMTcuMTE2N3oiIGZpbGw9IiNjYzYyMjgiIHN0cm9rZT0iI2NjNjIyOCIvPjxwYXRoIGQ9Im0yNC4wOTgyIDIzLjUzMzUuNjM2NiA1LjMzODYgMy40OTQ2LTUuMjIxOXoiIGZpbGw9IiNjYzYyMjgiIHN0cm9rZT0iI2NjNjIyOCIvPjxwYXRoIGQ9Im0yNy4yMjkxIDE3LjY1MDctNy40MDUuMzM2OS42ODg1IDMuNzk2NiAxLjA5MTMtMi4yOTM1IDIuNjM3MiAxLjIwNTF6IiBmaWxsPSIjY2M2MjI4IiBzdHJva2U9IiNjYzYyMjgiLz48cGF0aCBkPSJtMTEuMzkyOSAyMC42OTU4IDIuNjI0Mi0xLjIwNTEgMS4wOTEzIDIuMjkzNS42ODg1LTMuNzk2Ni03LjQwNDk1LS4zMzY5eiIgZmlsbD0iI2NjNjIyOCIgc3Ryb2tlPSIjY2M2MjI4Ii8+PHBhdGggZD0ibTguMzkyIDE3LjY1MDcgMy4xMDQ5IDYuMDUxMy0uMTAzOS0zLjAwNjJ6IiBmaWxsPSIjZTI3NTI1IiBzdHJva2U9IiNlMjc1MjUiLz48cGF0aCBkPSJtMjQuMjQxMiAyMC42OTU4LS4xMTY5IDMuMDA2MiAzLjEwNDktNi4wNTEzeiIgZmlsbD0iI2UyNzUyNSIgc3Ryb2tlPSIjZTI3NTI1Ii8+PHBhdGggZD0ibTE1Ljc5NyAxNy45ODc2LS42ODg2IDMuNzk2Ny44NzA0IDQuNDgzMy4xOTQ5LTUuOTA4N3oiIGZpbGw9IiNlMjc1MjUiIHN0cm9rZT0iI2UyNzUyNSIvPjxwYXRoIGQ9Im0xOS44MjQyIDE3Ljk4NzYtLjM2MzggMi4zNTg0LjE4MTkgNS45MjE2Ljg3MDQtNC40ODMzeiIgZmlsbD0iI2UyNzUyNSIgc3Ryb2tlPSIjZTI3NTI1Ii8+PHBhdGggZD0ibTIwLjUxMjcgMjEuNzg0Mi0uODcwNCA0LjQ4MzQuNjIzNi40NDA2IDMuODU4NC0zLjAwNjIuMTE2OS0zLjAwNjJ6IiBmaWxsPSIjZjU4NDFmIiBzdHJva2U9IiNmNTg0MWYiLz48cGF0aCBkPSJtMTEuMzkyOSAyMC42OTU4LjEwNCAzLjAwNjIgMy44NTgzIDMuMDA2Mi42MjM2LS40NDA2LS44NzA0LTQuNDgzNHoiIGZpbGw9IiNmNTg0MWYiIHN0cm9rZT0iI2Y1ODQxZiIvPjxwYXRoIGQ9Im0yMC41OTA2IDMwLjg0MTcuMDM5LTEuMjMxLS4zMzc4LS4yODUxaC00Ljk2MjZsLS4zMjQ4LjI4NTEuMDI2IDEuMjMxLTQuMTU3Mi0xLjk2OTYgMS40NTUxIDEuMTkyMSAyLjk0ODkgMi4wMzQ0aDUuMDUzNmwyLjk2Mi0yLjAzNDQgMS40NDItMS4xOTIxeiIgZmlsbD0iI2MwYWM5ZCIgc3Ryb2tlPSIjYzBhYzlkIi8+PHBhdGggZD0ibTIwLjI2NTkgMjYuNzA4Mi0uNjIzNi0uNDQwNmgtMy42NjM1bC0uNjIzNi40NDA2LS4zNTA4IDIuOTAyNS4zMjQ4LS4yODUxaDQuOTYyNmwuMzM3OC4yODUxeiIgZmlsbD0iIzE2MTYxNiIgc3Ryb2tlPSIjMTYxNjE2Ii8+PHBhdGggZD0ibTMzLjUxNjggMTEuMzUzMiAxLjEwNDMtNS4zNjQ0Ny0xLjY2MjktNC45ODg3My0xMi42OTIzIDkuMzk0NCA0Ljg4NDYgNC4xMjA1IDYuODk4MyAyLjAwODUgMS41Mi0xLjc3NTItLjY2MjYtLjQ3OTUgMS4wNTIzLS45NTg4LS44MDU0LS42MjIgMS4wNTIzLS44MDM0eiIgZmlsbD0iIzc2M2UxYSIgc3Ryb2tlPSIjNzYzZTFhIi8+PHBhdGggZD0ibTEgNS45ODg3MyAxLjExNzI0IDUuMzY0NDctLjcxNDUxLjUzMTMgMS4wNjUyNy44MDM0LS44MDU0NS42MjIgMS4wNTIyOC45NTg4LS42NjI1NS40Nzk1IDEuNTE5OTcgMS43NzUyIDYuODk4MzUtMi4wMDg1IDQuODg0Ni00LjEyMDUtMTIuNjkyMzMtOS4zOTQ0eiIgZmlsbD0iIzc2M2UxYSIgc3Ryb2tlPSIjNzYzZTFhIi8+PHBhdGggZD0ibTMyLjA0ODkgMTYuNTIzNC02Ljg5ODMtMi4wMDg1IDIuMDc4NiAzLjEzNTgtMy4xMDQ5IDYuMDUxMyA0LjEwNTItLjA1MTloNi4xMzE4eiIgZmlsbD0iI2Y1ODQxZiIgc3Ryb2tlPSIjZjU4NDFmIi8+PHBhdGggZD0ibTEwLjQ3MDUgMTQuNTE0OS02Ljg5ODI4IDIuMDA4NS0yLjI5OTQ0IDcuMTI2N2g2LjExODgzbDQuMTA1MTkuMDUxOS0zLjEwNDg3LTYuMDUxM3oiIGZpbGw9IiNmNTg0MWYiIHN0cm9rZT0iI2Y1ODQxZiIvPjxwYXRoIGQ9Im0xOS44MjQxIDE3Ljk4NzYuNDQxNy03LjU5MzIgMi4wMDA3LTUuNDAzNGgtOC45MTE5bDIuMDAwNiA1LjQwMzQuNDQxNyA3LjU5MzIuMTY4OSAyLjM4NDIuMDEzIDUuODk1OGgzLjY2MzVsLjAxMy01Ljg5NTh6IiBmaWxsPSIjZjU4NDFmIiBzdHJva2U9IiNmNTg0MWYiLz48L2c+PC9zdmc+',
      rdns: 'io.metamask'
    }
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info, provider: window.ethereum })
      })
    )
  }

  window.addEventListener('eip6963:requestProvider', () => {
    announceProvider()
  })

  const ev = new Event('ethereum#initialized')
  window.dispatchEvent(ev)
}

const exposeWindowEthereumProvider = `(${initProvider.toString()})()`
webFrame.executeJavaScript(exposeWindowEthereumProvider)
