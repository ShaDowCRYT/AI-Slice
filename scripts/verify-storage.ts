// Standalone verification of lib/storage/r2.ts — run with `npx tsx scripts/verify-storage.ts`.
// Uploads a throwaway object, reads it back, and confirms bytes round-trip.
// This proof is required before anything else depends on storage (Phase 1, step 2).

import {
  storageBackend,
  uploadFile,
  readFileBytes,
} from "../lib/storage/r2";

async function main() {
  const backend = storageBackend();
  console.log(`Storage backend: ${backend}`);

  const seed = Buffer.from(`verification-upload-${Date.now()}`);
  const key = await uploadFile(
    { data: seed, mimeType: "image/jpeg", ext: "jpg" },
    "verify-user",
  );
  console.log(`Uploaded with key: ${key}`);

  const roundTripped = await readFileBytes(key);
  const ok =
    roundTripped.length === seed.length &&
    roundTripped.equals(seed);

  console.log(`Bytes round-tripped: ${ok}`);
  if (!ok) {
    console.error("Round-trip failed — bytes differ.");
    process.exit(1);
  }
  console.log("Storage verification PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});