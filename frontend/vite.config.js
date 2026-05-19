import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /** Cache-friendly vendor chunks — no UI changes, smaller repeat-download cost when app code changes */
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("react-dom")) return "vendor-react-dom";
          if (id.includes("/react/") || id.includes("\\react\\") || id.includes("react/jsx-runtime")) return "vendor-react-core";
          return undefined;
        }
      }
    }
  }
});
