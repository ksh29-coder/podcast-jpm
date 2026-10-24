import { File } from 'expo-file-system';

// A chosen photo's bytes (the web version is readBytes.web.ts).
export const readBytes = (asset: { uri: string }) => new File(asset.uri).arrayBuffer();
