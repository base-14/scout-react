const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
const peers = [
    'react',
    'react-dom',
    'react-native',
    '@react-native-async-storage/async-storage',
    '@react-native-community/netinfo',
    'react-native-device-info',
    'expo-battery',
    '@react-navigation/native',
    '@react-navigation/bottom-tabs',
    '@react-navigation/native-stack',
    'react-native-screens',
    'react-native-safe-area-context',
];
config.resolver.extraNodeModules = {
    ...(config.resolver.extraNodeModules ?? {}),
    ...Object.fromEntries(peers.map((name) => [name, path.resolve(projectRoot, 'node_modules', name)])),
};
module.exports = config;
