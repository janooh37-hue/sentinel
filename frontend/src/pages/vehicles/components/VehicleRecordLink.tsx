import { useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { AuthContext } from '@/lib/authContext'
import { scopedRoleOf } from '@/lib/scopedRole'
import { useCapabilities } from '@/lib/useCapabilities'

/** Fleet data can name another reporter's private draft. Resolve visibility
 * through the same cached detail request as Records before offering its link. */
export function VehicleRecordLink({ bookId, children, className, fallback }: {
  bookId: number
  children: ReactNode
  className?: string
  fallback?: ReactNode
}): React.JSX.Element {
  const scoped = scopedRoleOf(useContext(AuthContext)?.user) !== null
  const { has } = useCapabilities()
  const canView = has('books.view')
  const book = useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => api.getBook(bookId),
    enabled: scoped && canView,
    retry: false,
  })

  if (scoped && (!canView || !book.isSuccess)) {
    return <span className="text-muted-foreground">{fallback ?? children}</span>
  }
  return <Link to={`/books/${bookId}`} className={className}>{children}</Link>
}
