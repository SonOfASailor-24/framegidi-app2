import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // If you deploy to GitHub Pages at https://<user>.github.io/<repo>/,
  // uncomment and set base to '/<repo>/' — otherwise leave as '/'.
  // base: '/framegidi-production-os/',
});
