import * as ImagePicker from 'expo-image-picker';
import { api, type PictureFile } from './api';
import { readBytes } from './readBytes';

// Pieces small enough for one request to our server (it takes up to 4 MB).
const PIECE = 3 * 1024 * 1024;

// Lets the person choose a picture from their photos and sends it to the
// server, which checks it and makes it a sensible size. null if they didn't
// choose one.
export async function pickPicture(): Promise<PictureFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
  if (result.canceled) return null;
  const bytes = new Uint8Array(await readBytes(result.assets[0]));
  const { id } = await api.createPicture();
  for (let offset = 0; offset < bytes.length; offset += PIECE) {
    await api.addPictureData(id, offset, bytes.subarray(offset, offset + PIECE));
  }
  return api.finishPicture(id);
}
