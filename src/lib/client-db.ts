"use client";

import { openDB } from "idb";

const databaseName = "aula-sscs0208";
const storeName = "preferences";

async function database() {
  return openDB(databaseName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    },
  });
}

export async function readPreference<T>(key: string, fallback: T): Promise<T> {
  try {
    return ((await (await database()).get(storeName, key)) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function writePreference<T>(key: string, value: T) {
  try {
    await (await database()).put(storeName, value, key);
  } catch {
    // The app remains usable when browser storage is disabled.
  }
}

export async function appendPreference<T>(
  key: string,
  value: T,
  maximumItems = 100,
) {
  try {
    const db = await database();
    const current = ((await db.get(storeName, key)) as T[] | undefined) ?? [];
    await db.put(storeName, [value, ...current].slice(0, maximumItems), key);
  } catch {
    // The app remains usable when browser storage is disabled.
  }
}

export async function clearStudyData() {
  try {
    const db = await database();
    await db.clear(storeName);
  } catch {
    // The app remains usable when browser storage is disabled.
  }
}
