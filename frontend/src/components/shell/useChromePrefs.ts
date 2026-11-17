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

export function useChromePrefs(scoped: boolean) {
  const qc = useQueryClient()
  const [localFontScale, setLocalFontScale] = useState(
    () => getStoredFontScale() ?? migrateLegacyFontScale(undefined),
  )
  const [localTheme, setLocalTheme] = useState<Theme>(() => getStoredTheme() ?? 'light')
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    enabled: !scoped,
  })
  const update = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  useEffect(() => {
    if (!scoped && settings?.theme) persistTheme(settings.theme as Theme)
  }, [scoped, settings?.theme])
  useEffect(() => {
    if (!scoped && typeof settings?.font_scale === 'number') {
      persistFontScale(settings.font_scale)
    }
  }, [scoped, settings?.font_scale])

  return {
    fontScale: scoped ? localFontScale : migrateLegacyFontScale(settings?.font_scale),
    theme: scoped ? localTheme : (settings?.theme ?? 'light') as Theme,
    setFontScale: (value: number) => {
      persistFontScale(value)
      if (scoped) setLocalFontScale(value)
      else update.mutate({ font_scale: value })
    },
    setTheme: (value: Theme) => {
      persistTheme(value)
      if (scoped) setLocalTheme(value)
      else update.mutate({ theme: value })
    },
  }
}
