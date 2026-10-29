// The register owns routing; the workspace owns its unsaved draft and review.
// Returning true means the workspace handled (or blocked) the navigation.
let activeGuard: ((proceed: () => void) => boolean) | undefined

export function requestWorkspaceNavigation(proceed: () => void): boolean {
  return activeGuard?.(proceed) ?? false
}

export function registerWorkspaceNavigation(
  guard: (proceed: () => void) => boolean,
): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = undefined
  }
}
