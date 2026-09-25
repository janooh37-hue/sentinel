import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Theme } from '@/lib/api'
import {
  getStoredFontScale,
  getStoredTheme,
  migrateLegacyFontScale,
  persistFontScale,
  persistTheme,
} from '@/lib/theme'

export function useChromePrefs(isInmateReporter: boolean) {
  const qc = useQueryClient()
  const [localFontScale, setLocalFontScale] = useState(
    () => getStoredFontScale() ?? migrateLegacyFontScale(undefined),
  )
  const [localTheme, setLocalTheme] = useState<Theme>(() => getStoredTheme() ?? 'light')
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    enabled: !isInmateReporter,
  })
  const update = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  useEffect(() => {
    if (!isInmateReporter && settings?.theme) persistTheme(settings.theme as Theme)
  }, [isInmateReporter, settings?.theme])
  useEffect(() => {
    if (!isInmateReporter && typeof settings?.font_scale === 'number') {
      persistFontScale(settings.font_scale)
    }
  }, [isInmateReporter, settings?.font_scale])

  return {
    fontScale: isInmateReporter ? localFontScale : migrateLegacyFontScale(settings?.font_scale),
    theme: isInmateReporter ? localTheme : (settings?.theme ?? 'light') as Theme,
    setFontScale: (value: number) => {
      persistFontScale(value)
      if (isInmateReporter) setLocalFontScale(value)
      else update.mutate({ font_scale: value })
    },
    setTheme: (value: Theme) => {
      persistTheme(value)
      if (isInmateReporter) setLocalTheme(value)
      else update.mutate({ theme: value })
    },
  }
}
