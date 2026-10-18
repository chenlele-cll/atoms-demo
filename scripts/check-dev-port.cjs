const net = require('node:net');

// Keep the managed profile's ports aligned with process-compose.yaml.
const portText = process.argv[2];
if (process.argv.length !== 3 || !['3001', '5173'].includes(portText)) {
  console.error('Usage: node scripts/check-dev-port.cjs <3001|5173>');
  process.exitCode = 1;
} else {
  const host = '127.0.0.1';
  const port = Number(portText);
  const server = net.createServer();
  server.once('error', (err) => {
    console.error(`Cannot start managed service: ${host}:${port} is unavailable (${err.code}). Stop its owner or use an independent application command.`);
    process.exitCode = 1;
  });
  server.listen({ host, port, exclusive: true }, () => {
    server.close();
  });
}
