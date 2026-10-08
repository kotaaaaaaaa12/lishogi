import {randomBytes} from 'node:crypto';
const encoding = process.argv.includes('--password') ? 'base64' : 'hex';
process.stdout.write(`${randomBytes(32).toString(encoding)}\n`);
