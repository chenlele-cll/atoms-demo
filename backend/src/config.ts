type ServerConfig = {
  readonly host: string;
  readonly port: number;
};

export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const host = env['HOST'] ?? '127.0.0.1';
  const portText = env['PORT'] ?? '3001';
  const port = Number(portText);

  if (host.trim().length === 0) {
    throw new TypeError('HOST must not be blank');
  }

  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('PORT must be an integer between 1 and 65535');
  }

  return { host, port };
}
