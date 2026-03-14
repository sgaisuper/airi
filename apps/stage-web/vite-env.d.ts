/// <reference types="vite/client" />
/// <reference types="../../vite-env.d.ts" />

interface ImportMetaEnv {
  readonly VITE_APP_TARGET_HUGGINGFACE_SPACE: string
  readonly VITE_OPENAI_API_KEY?: string
  readonly VITE_OPENAI_BASE_URL?: string
  readonly VITE_OPENAI_MODEL?: string
}
