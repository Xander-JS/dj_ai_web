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

**DeepSeek:** set `DEEPSEEK_API_KEY` in `.env` (or `.env.local`) to use DeepSeek (`deepseek-chat`) instead of Gemini. When both keys are set, DeepSeek wins. The same server-only rules below apply to it.

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

## DeepSeek automatic mixing

Automatic mixing requests `/api/ai/mix-plan` from the FastAPI backend. Vite proxies this path to port 8000 in development. Local harmonic/tempo ranking prepares the next deck immediately; DeepSeek plans the prepared pair with an early entry point, transition length, and bounded adjustments targeting either deck. EQ, filter and volume move from the beginning even while the request is pending. Local fallback starts an overlap after 64 beats (or earlier near the track end). The browser validates the plan and runs the audio controls locally. Missing login, unavailable service, invalid plans or quota exhaustion preserve local mixing. Audio files and waveforms never enter the request.

Automatic cues use vacant slots in order 5–8, then 1–4, without replacing saved cues. Their positions are beat-based preparation markers, not inferred musical sections. Manual cue writes are serialized with automatic creation. Manual controls retain priority for five seconds after release. BAR SYNC requires confirmed grid metadata; the mode never confirms downbeats itself. A new lead track cancels obsolete planning; disabling the mode aborts requests and removes its timer and listeners.

Install `server/requirements.txt`, then set **server environment variables** `DEEPSEEK_API_KEY`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The backend verifies the user's bearer token through Supabase before spending provider tokens. Process environment variables take precedence. For local use the backend also reads root `.env.local` then `.env`, and accepts `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` as fallbacks for the public Supabase configuration. The DeepSeek key remains server-only.

Production: run `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1` from `server/`, behind HTTPS. Serve the built frontend and reverse-proxy `/api/ai/mix-plan` to this service on the same origin. Never publish the provider key as a `VITE_*` variable. The process enforces one concurrent call, at least 15 seconds between calls, and at most 60 calls per hour per authenticated user. This limiter is process-local: keep one worker/replica; shared persistent quotas are required before scaling horizontally. Restarting the backend resets its hourly counters.

Each activation plans a reference track at most once, with at most five candidates, eight adjustments and 700 output tokens. There are no automatic retries or periodic model calls. Stopping/unmounting aborts the client request; a disconnect cancels the backend task and closes the upstream connection. A request already accepted by the provider may still be billed. Calls that failed or were cancelled also count towards the backend quota.

Tests: `cd server && .venv/bin/python -m unittest discover -s tests`, plus `npm test` at repository root. These use simulated provider responses and do not certify subjective musical quality or a live deployment.
