import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A API é chamada por URL absoluta (CORS liberado para BACKOFFICE_ORIGIN).
  define: { __API_URL__: JSON.stringify(process.env.VITE_API_URL ?? 'http://localhost:3333') },
  server: { port: 5174, host: true },
});
