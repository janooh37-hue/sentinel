export type WeatherCategory = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' | 'unknown'

export interface LockWeather {
  location: string
  temperatureC: number
  highC: number
  lowC: number
  humidity: number
  weatherCode: number
  isDay: boolean
}

interface LocationResponse {
  latitude?: unknown
  longitude?: unknown
  city?: unknown
  locality?: unknown
}

interface ForecastResponse {
  current?: {
    temperature_2m?: unknown
    relative_humidity_2m?: unknown
    weather_code?: unknown
    is_day?: unknown
  }
  daily?: {
    temperature_2m_max?: unknown
    temperature_2m_min?: unknown
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

export function weatherCategory(code: number): WeatherCategory {
  if (code === 0) return 'clear'
  if (code >= 1 && code <= 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95 && code <= 99) return 'storm'
  return 'unknown'
}

export async function loadLockWeather(
  locale: 'en' | 'ar',
  signal?: AbortSignal,
): Promise<LockWeather | null> {
  const locationUrl = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  locationUrl.searchParams.set('localityLanguage', locale)
  const location = await fetchJson<LocationResponse>(locationUrl.toString(), signal)
  if (!location) return null

  const latitude = finiteNumber(location.latitude)
  const longitude = finiteNumber(location.longitude)
  if (latitude === null || longitude === null) return null

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
  forecastUrl.searchParams.set('latitude', String(latitude))
  forecastUrl.searchParams.set('longitude', String(longitude))
  forecastUrl.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,weather_code,is_day',
  )
  forecastUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min')
  forecastUrl.searchParams.set('timezone', 'auto')
  forecastUrl.searchParams.set('forecast_days', '1')

  const forecast = await fetchJson<ForecastResponse>(forecastUrl.toString(), signal)
  const current = forecast?.current
  const daily = forecast?.daily
  const high = Array.isArray(daily?.temperature_2m_max)
    ? finiteNumber(daily.temperature_2m_max[0])
    : null
  const low = Array.isArray(daily?.temperature_2m_min)
    ? finiteNumber(daily.temperature_2m_min[0])
    : null
  const temperature = finiteNumber(current?.temperature_2m)
  const humidity = finiteNumber(current?.relative_humidity_2m)
  const weatherCode = finiteNumber(current?.weather_code)
  const isDay = finiteNumber(current?.is_day)
  if (
    temperature === null ||
    humidity === null ||
    weatherCode === null ||
    isDay === null ||
    high === null ||
    low === null
  ) {
    return null
  }

  const locality = typeof location.locality === 'string' ? location.locality.trim() : ''
  const city = typeof location.city === 'string' ? location.city.trim() : ''
  return {
    location: locality || city,
    temperatureC: temperature,
    highC: high,
    lowC: low,
    humidity,
    weatherCode,
    isDay: isDay === 1,
  }
}
