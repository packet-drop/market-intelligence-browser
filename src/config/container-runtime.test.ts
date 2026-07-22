import { readFileSync } from 'fs';
import path from 'path';

describe('container runtime privilege boundary', () => {
  const dockerfile = readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
  const entrypoint = readFileSync(path.join(process.cwd(), 'docker', 'entrypoint.sh'), 'utf8');

  test('wires the volume initialization entrypoint into the production image', () => {
    expect(dockerfile).toContain('apt-get install -y --no-install-recommends gosu');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/market-intelligence-entrypoint"]');
    expect(dockerfile).toContain('CMD gosu nodejs node -e');
    expect(dockerfile).not.toMatch(/^USER nodejs$/m);
  });

  test('limits ownership changes to /data and drops privileges before the app starts', () => {
    const ownershipChange = entrypoint.indexOf('chown -R nodejs:nodejs /data');
    const permissionChange = entrypoint.indexOf('chmod 0700 /data');
    const privilegeDrop = entrypoint.indexOf('exec gosu nodejs "$@"');

    expect(ownershipChange).toBeGreaterThan(-1);
    expect(permissionChange).toBeGreaterThan(ownershipChange);
    expect(privilegeDrop).toBeGreaterThan(permissionChange);
    expect(entrypoint).not.toContain('SEEKING_ALPHA_SESSION_PATH');
    expect(entrypoint).not.toContain('RAILWAY_VOLUME_MOUNT_PATH');
    expect(entrypoint).not.toContain('\r');
  });
});
