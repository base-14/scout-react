import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        environment: 'node',
        globals: false,
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: [
                'src/core/**',
                'src/web/instrumentations/tap.ts',
                'src/web/instrumentations/route.ts',
                'src/web/instrumentations/error.ts',
                'src/web/instrumentations/network.ts',
            ],
            exclude: ['**/*.test.ts', '**/types.ts', 'src/test/**'],
            thresholds: {
                lines: 75,
                functions: 70,
                statements: 75,
                branches: 70,
            },
        },
    },
});
