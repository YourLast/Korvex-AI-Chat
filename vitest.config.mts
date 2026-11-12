import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'], environment: 'node', testTimeout: 20000, env: { MODELS_CONFIG: 'tests/fixtures/models.json', KX_TITLE_ENGINE_MODEL: 'alpha-engine', KX_INTRO_MODEL: 'alpha', KX_TITLE_STATE_MODEL: 'alpha', KX_SUPPORT_TG: 'https://t.me/korvex_support_test', KX_SUPPORT_EMAIL: 'support@example.com', KX_FEATURE_CODE: '1', KX_UPSTREAM_RETRY: '0', KX_MAINT_FILE: '', KX_SERVE_FORGET: '0', KX_WARM: '0', KX_API: '1' } },
});
