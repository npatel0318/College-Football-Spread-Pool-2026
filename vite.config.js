import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// IMPORTANT: if you're deploying to GitHub Pages as a project site
// (https://yourusername.github.io/your-repo-name/), "base" MUST match
// your repo name exactly, with leading and trailing slashes.
// If your repo is named e.g. "cfb-spread-pool", set base to "/cfb-spread-pool/".
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/College-Football-Spread-Pool-2026/",
});
