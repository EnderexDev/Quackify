// The app in a plain browser with Tauri replaced by mocks, to measure renders without a
// Spotify login. Numbers come from the production build with React's profiling build (the dev
// build is several times slower):
//   npx vite build --config bench/vite.config.ts && npx vite preview --config bench/vite.config.ts
// then open http://localhost:1431/bench/ and run `await __run()` in the page.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command }) => ({
  root: here(".."),
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": here("./mock-tauri.ts"),
      "@tauri-apps/api/event": here("./mock-tauri.ts"),
      "@tauri-apps/api/app": here("./mock-tauri.ts"),
      // Production speed, with the Profiler's timings still reported.
      ...(command === "build" ? { "react-dom/client": "react-dom/profiling" } : {}),
    },
  },
  server: { port: 1430, strictPort: true },
  preview: { port: 1431, strictPort: true },
  // Not minified, so the render counts keep the component names.
  build: { minify: false, outDir: here("./dist"), emptyOutDir: true, rollupOptions: { input: here("./index.html") } },
}));
