import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadLockWeather, weatherCategory } from './lockWeather'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('loadLockWeather', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('locates the browser by IP and requests current weather for those coordinates', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ latitude: 24.21, longitude: 54.69, city: 'Abu Dhabi', locality: 'Al Wathba' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          current: {
            temperature_2m: 41.2,
            relative_humidity_2m: 42,
            weather_code: 0,
            is_day: 1,
          },
          daily: {
            temperature_2m_max: [43.1],
            temperature_2m_min: [31.2],
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadLockWeather('en')).resolves.toEqual({
      location: 'Al Wathba',
      temperatureC: 41.2,
      highC: 43.1,
      lowC: 31.2,
      humidity: 42,
      weatherCode: 0,
      isDay: true,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    const weatherUrl = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(weatherUrl.origin + weatherUrl.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(weatherUrl.searchParams.get('latitude')).toBe('24.21')
    expect(weatherUrl.searchParams.get('longitude')).toBe('54.69')
    expect(weatherUrl.searchParams.get('timezone')).toBe('auto')
    expect(weatherUrl.searchParams.get('current')).toContain('weather_code')
    expect(weatherUrl.searchParams.get('daily')).toContain('temperature_2m_max')
  })

  it('requests a localized place name without changing the weather coordinates', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ latitude: 24.21, longitude: 54.69, city: 'أبوظبي', locality: 'الوثبة' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          current: {
            temperature_2m: 35,
            relative_humidity_2m: 50,
            weather_code: 2,
            is_day: 0,
          },
          daily: { temperature_2m_max: [39], temperature_2m_min: [28] },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadLockWeather('ar')

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('localityLanguage=ar')
    expect(result?.location).toBe('الوثبة')
    expect(result?.isDay).toBe(false)
  })

  it('fails closed when the location response has no usable coordinates', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ city: 'Unknown' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadLockWeather('en')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('weatherCategory', () => {
  it.each([
    [0, 'clear'],
    [2, 'cloudy'],
    [45, 'fog'],
    [63, 'rain'],
    [73, 'snow'],
    [95, 'storm'],
    [999, 'unknown'],
  ] as const)('maps WMO code %s to %s', (code, expected) => {
    expect(weatherCategory(code)).toBe(expected)
  })
})
