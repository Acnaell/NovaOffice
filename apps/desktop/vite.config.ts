import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O Tauri carrega o front-end desta porta em desenvolvimento (tauri.conf.json: devUrl).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome105",
    outDir: "dist",
  },
});
