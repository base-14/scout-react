import { defineConfig } from 'tsup';
export default defineConfig({
    entry: {
        'web/index': 'src/index.ts',
        'web/react/index': 'src/web/react/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    external: [
        'react',
        'react-native',
        '@react-native-async-storage/async-storage',
        '@react-native-community/netinfo',
        'react-native-device-info',
        '@react-navigation/native',
    ],
});
