# Agents

## Cursor Cloud specific instructions

### Overview

Skipper is a React Native (Expo SDK 55) mobile app for expectant/new mothers. In this cloud VM, it runs in **web mode** (`npx expo start --web`).

### Running the dev server

```bash
npx expo start --web --port 8081
```

The app renders at `http://localhost:8081`. The main entry point is `App.tsx` (default Expo template). Additional screens in `src/screens/` use NativeWind for styling.

### Key dependency caveats

- **NativeWind v2 + tailwindcss version**: The project uses NativeWind v2 (`nativewind/babel` plugin). tailwindcss must stay at **3.2.x** (not 3.3+), because tailwindcss 3.3+ changed its PostCSS plugin to async, which breaks NativeWind v2's synchronous CSS processing.
- **No ESLint config**: The project has no `.eslintrc` or lint script. Use `npx tsc --noEmit` for type checking. Pre-existing TS errors about `className` on RN components are expected (NativeWind's type augmentations are not fully configured in this repo).
- **No test framework**: No test runner is configured (no Jest, Vitest, etc.).
- **Supabase**: The `.env` file needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` for backend features. The app starts without valid credentials (values default to empty strings).

### Build

```bash
npx expo export --platform web
```

Outputs static files to `dist/`.
