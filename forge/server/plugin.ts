/**
 * The forge's dev-server half: one endpoint that writes a registry file. The
 * plugin applies to `vite` (serve) only, so a build has no trace of it.
 */
import type { Plugin } from 'vite';
import type { AnySystem } from '../../src/kernel/system';
import { saveRegistry } from './save';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function forge(): Plugin {
  return {
    name: 'ksgb-forge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__forge/save', (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });

        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_BODY_BYTES) chunks.push(chunk);
        });
        req.on('end', async () => {
          try {
            if (size > MAX_BODY_BYTES) return reply(413, { error: 'body too large' });
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              registry?: unknown;
              records?: unknown;
            };
            if (typeof body.registry !== 'string') return reply(400, { error: 'registry must be a string' });
            // Loaded through Vite so import.meta.glob in src/systems/index.ts works.
            const module = (await server.ssrLoadModule('/src/systems/index.ts')) as { systems: AnySystem[] };
            const result = saveRegistry(server.config.root, module.systems, body.registry, body.records);
            reply(result.ok ? 200 : 422, result);
          } catch (err) {
            reply(500, { error: (err as Error).message });
          }
        });
      });
    },
  };
}
