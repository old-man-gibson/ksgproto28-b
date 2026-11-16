import { MemoryStorage, type StorageLike } from '../kernel';

/** The build mode: "development" on the dev server, "production" in a build. */
export const MODE = import.meta.env.MODE;

/** localStorage, or memory when the browser blocks storage. */
export function browserStorage(): StorageLike {
  try {
    const storage = window.localStorage;
    storage.getItem('ksgb:probe');
    return storage;
  } catch {
    return new MemoryStorage();
  }
}
