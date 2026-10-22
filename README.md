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

The application uses its **local deterministic recommendation engine by default**. It compares the locally analyzed BPM and Camelot key, applies the existing pitch-range and compatibility rules, and returns results marked as local. This is a fixed heuristic, not an AI model, and it requires no API key or network request. A reference track must have analyzed BPM and key; candidates with insufficient musical data do not receive invented compatibility scores.

The client validates returned recommendation IDs, scores, and explanations against the local candidate metadata before displaying them. A remote request failure is returned as an error; the service does not silently relabel a failed Gemini request as a successful AI result.

### Optional local Gemini development endpoint

`vite.config.ts` contains a server-side middleware for the Vite development server only. It reads `GEMINI_API_KEY` from the server environment and calls Gemini from that process. The key is not a `VITE_*` variable and is not included in the browser bundle. To exercise this endpoint from code, call `getTrackRecommendations(..., { mode: 'remote' })`; the application UI stays on local deterministic mode.

For local development only, copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` there. `.env.local` is ignored by Git. Never use a `VITE_*` variable for the provider key. The Vite middleware is not a production backend: it has no deployment contract, authentication, rate limiting, or operational controls, and is not mounted in `vite preview`. A static production deployment has no Gemini endpoint. Do not deploy a provider key with the frontend. A production remote mode requires a separately specified and deployed secure backend.

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
