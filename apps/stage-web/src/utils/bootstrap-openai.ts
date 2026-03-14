import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1/'
const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'

function normalizeBaseUrl(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return DEFAULT_OPENAI_BASE_URL
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

export async function bootstrapOpenAIFromEnv() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return false
  }

  const providersStore = useProvidersStore()
  const onboardingStore = useOnboardingStore()
  const consciousnessStore = useConsciousnessStore()

  const previousConfig = providersStore.getProviderConfig('openai')
  const nextConfig = {
    ...previousConfig,
    apiKey,
    baseUrl: normalizeBaseUrl(import.meta.env.VITE_OPENAI_BASE_URL),
  }

  providersStore.providers.openai = nextConfig
  providersStore.markProviderAdded('openai')

  const isConfigured = await providersStore.validateProvider('openai', { force: true })
  if (!isConfigured) {
    if (previousConfig) {
      providersStore.providers.openai = previousConfig
    }
    else {
      providersStore.deleteProvider('openai')
      providersStore.initializeProvider('openai')
    }

    return false
  }

  const shouldApplyDefaults = onboardingStore.needsOnboarding || !consciousnessStore.activeProvider
  if (shouldApplyDefaults) {
    consciousnessStore.activeProvider = 'openai'
  }

  await consciousnessStore.loadModelsForProvider('openai')

  if (onboardingStore.needsOnboarding || !consciousnessStore.activeModel) {
    consciousnessStore.activeModel = import.meta.env.VITE_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL
  }

  if (onboardingStore.needsOnboarding) {
    onboardingStore.markSetupCompleted()
  }

  return true
}
