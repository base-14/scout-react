export interface PlatformAdapter {
  readonly name: 'web' | 'react-native';
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  collectResourceAttributes(): Promise<Record<string, string | number | boolean>>;
  getConnectionType(): string;
  onConnectivityChange?(handler: (type: string) => void): () => void;
  readAppVersion?(): Promise<string | null>;
  readAppMetadata?(): Promise<{
    version: string | null;
    build: string | null;
    bundleId: string | null;
  }>;
}
