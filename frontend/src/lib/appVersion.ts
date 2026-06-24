/**
 * Single source of truth for the app version string shown in the UI.
 *
 * Kept here rather than duplicated across components (e.g. ErrorBoundary,
 * AboutSection) so a version bump only requires editing this file.
 *
 * The string should stay in sync with `backend/app/__init__.py::__version__`.
 */
export const APP_VERSION = 'v4.0.0'
