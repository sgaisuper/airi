import type { App } from 'vue'
import type { Router } from 'vue-router'

import posthog from 'posthog-js'

import { isStandalone } from '../utils/platform'

const DIAGNOSTIC_STORAGE_KEY = 'airi:runtime-diagnostics'
const DIAGNOSTIC_MAX_EVENTS = 40
const DIAGNOSTIC_MAX_STRING_LENGTH = 500

type DiagnosticLevel = 'info' | 'warn' | 'error'

interface DiagnosticEvent {
  event: string
  level: DiagnosticLevel
  timestamp: string
  details: Record<string, unknown>
}

function truncateString(value: string) {
  return value.length > DIAGNOSTIC_MAX_STRING_LENGTH
    ? `${value.slice(0, DIAGNOSTIC_MAX_STRING_LENGTH)}...`
    : value
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateString(error.message),
      stack: typeof error.stack === 'string' ? truncateString(error.stack) : undefined,
      cause: error.cause ? serializeUnknown(error.cause) : undefined,
    }
  }

  return serializeUnknown(error)
}

function serializeUnknown(value: unknown): unknown {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Error) {
    return serializeError(value)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(serializeUnknown)
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20)
    return Object.fromEntries(entries.map(([key, item]) => [key, serializeUnknown(item)]))
  }

  return truncateString(String(value))
}

function getDiagnosticContext() {
  if (typeof window === 'undefined') {
    return {}
  }

  return {
    href: window.location.href,
    path: window.location.pathname,
    hash: window.location.hash,
    visibility_state: document.visibilityState,
    online: navigator.onLine,
    user_agent: truncateString(navigator.userAgent),
    standalone: isStandalone(),
  }
}

function storeDiagnosticEvent(entry: DiagnosticEvent) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const existing = window.localStorage.getItem(DIAGNOSTIC_STORAGE_KEY)
    const events = existing ? JSON.parse(existing) as DiagnosticEvent[] : []
    events.push(entry)
    window.localStorage.setItem(
      DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(events.slice(-DIAGNOSTIC_MAX_EVENTS)),
    )
  }
  catch {
  }
}

export function captureRuntimeDiagnostic(
  event: string,
  details: Record<string, unknown> = {},
  level: DiagnosticLevel = 'info',
) {
  const payload = {
    ...getDiagnosticContext(),
    ...Object.fromEntries(
      Object.entries(details).map(([key, value]) => [key, serializeUnknown(value)]),
    ),
  }

  const entry: DiagnosticEvent = {
    event,
    level,
    timestamp: new Date().toISOString(),
    details: payload,
  }

  storeDiagnosticEvent(entry)

  try {
    posthog.capture('runtime_diagnostic', {
      diagnostic_event: event,
      diagnostic_level: level,
      ...payload,
    })
  }
  catch {
  }

  const logger = level === 'error'
    ? console.error
    : level === 'warn'
      ? console.warn
      : console.info

  logger(`[runtime-diagnostic] ${event}`, payload)
}

export async function runWithRuntimeDiagnostics<T>(
  step: string,
  run: () => Promise<T>,
) {
  captureRuntimeDiagnostic('app_bootstrap_step_started', { step })

  try {
    const result = await run()
    captureRuntimeDiagnostic('app_bootstrap_step_completed', { step })
    return result
  }
  catch (error) {
    captureRuntimeDiagnostic('app_bootstrap_step_failed', { step, error }, 'error')
    throw error
  }
}

function getErrorTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return undefined
  }

  return {
    tag_name: target.tagName,
    id: target.id || undefined,
    class_name: target.className || undefined,
    source: target.getAttribute('src') ?? target.getAttribute('href') ?? undefined,
  }
}

export function installRuntimeDiagnostics(app: App, router: Router) {
  if (typeof window === 'undefined') {
    return
  }

  const existingErrorHandler = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    captureRuntimeDiagnostic('vue_error', {
      error,
      info,
      component: instance?.$options?.name ?? instance?.$options?.__name,
    }, 'error')

    existingErrorHandler?.(error, instance, info)
  }

  window.addEventListener('error', (event) => {
    const target = getErrorTarget(event.target)

    if (target?.source) {
      captureRuntimeDiagnostic('resource_load_error', {
        message: event.message,
        filename: event.filename,
        target,
      }, 'error')
      return
    }

    captureRuntimeDiagnostic('window_error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    }, 'error')
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    captureRuntimeDiagnostic('unhandled_rejection', {
      reason: event.reason,
    }, 'error')
  })

  window.addEventListener('pageshow', event => captureRuntimeDiagnostic('page_show', { persisted: event.persisted }))
  window.addEventListener('pagehide', event => captureRuntimeDiagnostic('page_hide', { persisted: event.persisted }))
  window.addEventListener('online', () => captureRuntimeDiagnostic('network_online'))
  window.addEventListener('offline', () => captureRuntimeDiagnostic('network_offline', {}, 'warn'))
  document.addEventListener('visibilitychange', () => {
    captureRuntimeDiagnostic('visibility_changed', { visibility_state: document.visibilityState })
  })

  router.onError(error => captureRuntimeDiagnostic('router_error', { error }, 'error'))
  router.afterEach((to, from, failure) => {
    captureRuntimeDiagnostic('route_navigation', {
      to: to.fullPath,
      from: from.fullPath,
      failed: !!failure,
    }, failure ? 'warn' : 'info')
  })

  captureRuntimeDiagnostic('runtime_diagnostics_installed')
}
