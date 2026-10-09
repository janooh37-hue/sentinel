import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getVapidPublicKey = vi.fn()
const subscribePush = vi.fn()
vi.mock('../api', () => ({
  api: {
    getVapidPublicKey: () => getVapidPublicKey(),
    subscribePush: (body: unknown) => subscribePush(body),
  },
}))

import { subscribeToPush } from '../push'

const ENDPOINT = 'https://push.example/device-1'
const browserSub = {
  endpoint: ENDPOINT,
  toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }),
}
const getSubscription = vi.fn()
const subscribe = vi.fn()
const requestPermission = vi.fn()

describe('subscribeToPush', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    getSubscription.mockResolvedValue(null)
    subscribe.mockResolvedValue(browserSub)
    requestPermission.mockResolvedValue('granted')
    getVapidPublicKey.mockResolvedValue({ public_key: 'AAAA' })
    subscribePush.mockResolvedValue(undefined)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('Notification', { requestPermission })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: vi.fn().mockResolvedValue({ pushManager: { getSubscription, subscribe } }) },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('registers once, then makes no requests while the endpoint is unchanged', async () => {
    await subscribeToPush(7)
    expect(subscribePush).toHaveBeenCalledTimes(1)
    expect(subscribePush.mock.calls[0][0]).toMatchObject({ endpoint: ENDPOINT })

    vi.clearAllMocks()
    getSubscription.mockResolvedValue(browserSub) // the browser keeps it
    await subscribeToPush(7)

    expect(requestPermission).not.toHaveBeenCalled()
    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(subscribePush).not.toHaveBeenCalled()
  })

  it('re-registers the same device for a different signed-in user', async () => {
    await subscribeToPush(7)
    vi.clearAllMocks()
    getSubscription.mockResolvedValue(browserSub)

    await subscribeToPush(8)

    expect(getVapidPublicKey).not.toHaveBeenCalled()
    expect(subscribePush).toHaveBeenCalledTimes(1)
  })
})
