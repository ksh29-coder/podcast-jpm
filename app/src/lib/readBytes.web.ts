// A chosen photo's bytes, from the browser's File when there is one.
export const readBytes = (asset: { uri: string; file?: Blob }) => (asset.file ? asset.file.arrayBuffer() : fetch(asset.uri).then((r) => r.arrayBuffer()));
