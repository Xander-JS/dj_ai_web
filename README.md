# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## Recommendation engine and Gemini configuration

The local deterministic engine is the sole authority for recommendation eligibility, compatibility scores, and ordering. It compares locally analyzed BPM and Camelot data using the existing pitch-range and compatibility rules. After those results are available, the dashboard automatically requests optional natural-language explanations from Gemini for the selected tracks. The local recommendations remain visible and usable if Gemini is unavailable or not configured.

Gemini returns explanations only. The request contains a local track ID for correlation and only the approved track metadata: title, artist, BPM, key, Camelot notation, and energy when available. The client and development endpoint construct explicit allowlisted objects; local evaluations, scores, deck/audio state, and `localEvidence` are excluded. The client accepts text only for locally selected recommendation IDs, sanitizes it, and keeps all local metadata, scores, eligibility, and ordering unchanged. Missing or invalid explanations fall back to the local technical explanation.

### Optional local Gemini development endpoint

`vite.config.ts` contains a server-side middleware for the Vite development server only. It reads `GEMINI_API_KEY` from the server environment and calls Gemini from that process. The key is not a `VITE_*` variable and is not included in the browser bundle. The dashboard automatically posts selected local recommendations to `/api/ai/explanations` for text explanations.

For local development only, copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` there. `.env.local` is ignored by Git. Never use a `VITE_*` variable for the provider key. The middleware validates request method, shape, metadata, duplicate IDs, and a 16 KB body limit; it is still not a production backend and has no authentication, rate limiting, or operational controls. It is not mounted in `vite preview`, and a static production deployment has no Gemini endpoint. Do not deploy a provider key with the frontend. Automated tests use local mocks and do not certify that the live Gemini provider works. A production integration requires a separately specified and deployed backend.

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
