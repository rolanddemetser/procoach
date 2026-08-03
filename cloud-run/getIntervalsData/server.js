import { createServer } from 'node:http';
import { handleGetIntervalsData } from './src/getIntervalsDataV37.js';

const port = Number(process.env.PORT || 8080);

const server = createServer(async (req, res) => {
  await handleGetIntervalsData(req, res);
});

server.listen(port, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: 'getIntervalsData V37 listening', port }));
});
