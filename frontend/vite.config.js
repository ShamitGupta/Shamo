/* global process */
// Vite config runs in Node, where `process` is a global. The lint config
// targets browser sources, so it needs telling for this file alone.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // The app is served from https://shamoclasses.com/chatbot on Hostinger, so
  // that is the default and `npm run build` on its own is all the deploy
  // steps need -- same as it was before the line below briefly changed.
  //
  // It defaulted to '/' for a while, for a planned S3 + CloudFront move to
  // the domain root that has not happened. That silently broke the Hostinger
  // deploy: assets built at /assets/... instead of /chatbot/assets/..., which
  // looks like a perfectly clean build and then serves a blank page, because
  // every asset 404s one directory too high. Defaulting to where the app is
  // ACTUALLY deployed is what stops that being silent.
  //
  // To build for the domain root instead, override it -- from PowerShell, not
  // Git Bash, where MSYS rewrites a leading "/" into a Windows path:
  //
  //   $env:VITE_BASE_PATH = '/'; npm run build
  base: process.env.VITE_BASE_PATH || '/chatbot/',
  plugins: [react()],
})
