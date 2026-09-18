/* global process */
// Vite config runs in Node, where `process` is a global. The lint config
// targets browser sources, so it needs telling for this file alone.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // The app is served from the root of shamoclasses.com on AWS (S3 +
  // CloudFront). It previously lived under /chatbot/ on Hostinger shared
  // hosting, so this stays overridable for the duration of the cutover:
  //
  //   $env:VITE_BASE_PATH = '/chatbot/'; npm run build   # PowerShell
  //
  // Set it from PowerShell, not Git Bash: MSYS rewrites any value starting
  // with "/" into a Windows path, so VITE_BASE_PATH=/ silently becomes
  // "/Program Files/Git/" and every asset 404s. The default below is a plain
  // string literal and is immune to that.
  //
  // Getting this wrong is silent at build time and obvious at runtime -- the
  // page loads blank because every asset 404s at the wrong prefix.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
})
