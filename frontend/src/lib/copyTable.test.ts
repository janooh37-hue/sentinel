import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyTable } from './copyTable'

const HTML = '<table><tbody><tr><td>14 \\ 005821</td></tr></tbody></table>'
const TEXT = 'Plate\n14 \\ 005821'
const HOST_SELECTOR = '[aria-hidden="true"][contenteditable="true"]'

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
let execCommand = vi.fn<() => boolean>()

function copyEvent(setData: (format: string, data: string) => void): ClipboardEvent {
  const event = new Event('copy', { bubbles: true, cancelable: true })
  const types: string[] = []
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      setData: (format: string, data: string) => {
        setData(format, data)
        if (!types.includes(format)) types.push(format)
      },
      types,
    },
  })
  return event as ClipboardEvent
}

beforeEach(() => {
  vi.stubGlobal('ClipboardItem', undefined)
  execCommand = vi.fn<() => boolean>()
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommand,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalExecCommand) {
    Object.defineProperty(document, 'execCommand', originalExecCommand)
  } else {
    Reflect.deleteProperty(document, 'execCommand')
  }
  document.body.innerHTML = ''
})

describe('copyTable fallback', () => {
  it('writes both clipboard flavors and removes its temporary host', async () => {
    const setData = vi.fn()
    execCommand.mockImplementation(() => {
      document.dispatchEvent(copyEvent(setData))
      return true
    })

    await expect(copyTable({ html: HTML, text: TEXT })).resolves.toBeUndefined()

    expect(setData).toHaveBeenNthCalledWith(1, 'text/html', HTML)
    expect(setData).toHaveBeenNthCalledWith(2, 'text/plain', TEXT)
    expect(document.body.querySelector(HOST_SELECTOR)).toBeNull()
  })

  it('rejects and removes the host when execCommand returns false', async () => {
    const setData = vi.fn()
    execCommand.mockImplementation(() => {
      document.dispatchEvent(copyEvent(setData))
      return false
    })

    await expect(copyTable({ html: HTML, text: TEXT })).rejects.toThrow('COPY_FAILED')
    expect(document.body.querySelector(HOST_SELECTOR)).toBeNull()
  })

  it('rejects when execCommand reports success without a usable copy event', async () => {
    execCommand.mockReturnValue(true)

    await expect(copyTable({ html: HTML, text: TEXT })).rejects.toThrow('COPY_FAILED')
    expect(document.body.querySelector(HOST_SELECTOR)).toBeNull()
  })

  it('rejects and removes the host when execCommand throws', async () => {
    execCommand.mockImplementation(() => {
      throw new DOMException('Copy is not permitted')
    })

    await expect(copyTable({ html: HTML, text: TEXT })).rejects.toThrow('COPY_FAILED')
    expect(document.body.querySelector(HOST_SELECTOR)).toBeNull()
  })

  it('rejects when only one flavor actually lands on the clipboard despite setData not throwing', async () => {
    // A shell that silently drops a flavor without throwing: setData()
    // "succeeds" but only text/plain shows up in the readback `types` list.
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        setData: vi.fn(),
        types: ['text/plain'],
      },
    })
    execCommand.mockImplementation(() => {
      document.dispatchEvent(event)
      return true
    })

    await expect(copyTable({ html: HTML, text: TEXT })).rejects.toThrow('COPY_FAILED')
    expect(document.body.querySelector(HOST_SELECTOR)).toBeNull()
  })
})
