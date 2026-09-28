// Non-isolated Vitest config for the 3 R2-backed test files
// (assetInventoryLines, assetPhotos, financeAttachments).
//
// Why: @cloudflare/vitest-pool-workers 0.5.x fails isolated storage on R2
// WAL files ("Expected .sqlite, got ...sqlite-shm"), deterministically on
// Linux too — a test-library limitation, not an app failure. Release decision:
// these files run non-isolated as blocking evidence; the isolated run is
// deferred until the pool-workers upgrade.
//
// Run ONE file per vitest process from the repo root. Without isolation the
// storage is shared, so several files in one process contaminate each other
// (seen locally: "DELETE FROM assets: FOREIGN KEY constraint failed"):
//   npx vitest run --config test/vitest.r2-noniso.config.js test/assetPhotos.test.js
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'path';

export default defineWorkersConfig(async () => {
  const root = process.cwd();
  const migrations = await readD1Migrations(path.join(root, 'migrations'));

  return {
    test: {
      root,
      restoreMocks: true,
      unstubGlobals: true,
      setupFiles: [path.join(root, 'test/apply-migrations.js')],
      poolOptions: {
        workers: {
          isolatedStorage: false,
          singleWorker: true,
          wrangler: { configPath: path.join(root, 'wrangler.toml') },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
