// Stands in for the Resend API: records each email in outbox.json.
import http from 'node:http';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const OUT = process.env.TEAMFLOW_OUTBOX || new URL('./outbox.json', import.meta.url).pathname;
if (!existsSync(OUT)) writeFileSync(OUT, '[]');
http.createServer((req, res) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    const box = JSON.parse(readFileSync(OUT, 'utf8'));
    box.push({ ...body, auth: req.headers.authorization, at: new Date().toISOString() });
    writeFileSync(OUT, JSON.stringify(box, null, 2));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `fake-${box.length}` }));
  });
}).listen(54399, () => console.log('fake resend on 54399'));
