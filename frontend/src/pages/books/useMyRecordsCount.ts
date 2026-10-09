/**
 * useMyRecordsCount — how many records the signed-in user created.
 *
 * `GET /books/facets?created_by_me=true`, under the same React Query key the
 * Records page uses for its own facets while "Created by me" is on
 * (`['books','facets', true]`). The page badge and the AccountMenu row therefore
 * share one request and one cache entry, whatever the toggle's state.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

/** The facets key; `mine = true` is the badge query. */
export const booksFacetsKey = (mine: boolean): readonly ['books', 'facets', boolean] => [
  'books',
  'facets',
  mine,
]

export function useMyRecordsCount({ enabled = true }: { enabled?: boolean } = {}): {
  /** Total records created by me; `null` until the first response. */
  count: number | null
} {
  const query = useQuery({
    queryKey: booksFacetsKey(true),
    queryFn: () => api.getBookFacets({ created_by_me: true }),
    enabled,
  })
  return { count: query.data?.total ?? null }
}
