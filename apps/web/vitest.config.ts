import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: resolve(__dirname, 'tests/helpers/excalidraw-mock.tsx'),
      },
      {
        find: 'motion/react',
        replacement: resolve(__dirname, 'tests/helpers/motion-mock.tsx'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup/jsdom-lexical.ts'],
  },
});
