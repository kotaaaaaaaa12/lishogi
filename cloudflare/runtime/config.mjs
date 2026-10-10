import {writeFile, mkdir} from 'node:fs/promises';

export function buildConfiguration(env) {
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
      || origin.username || origin.password || origin.hostname === 'shogi.example.com'
      || origin.port || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(origin.hostname)) {
    throw new Error('Configure PUBLIC_ORIGIN with the public HTTPS origin.');
  }
  for (const key of ['PLAY_SECRET', 'USER_PASSWORD_SECRET', 'SHOGINET_KEY', 'CONTAINER_CONTROL_TOKEN']) {
    if (!env[key] || env[key].length < 32) throw new Error(`Configure a strong ${key} secret.`);
  }
  const passwordKey = Buffer.from(env.USER_PASSWORD_SECRET, 'base64');
  if (passwordKey.length !== 32 || passwordKey.toString('base64') !== env.USER_PASSWORD_SECRET) {
    throw new Error('USER_PASSWORD_SECRET must be the Base64 encoding of a 32-byte AES key.');
  }
  if (!env.MAIL_FROM || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.MAIL_FROM)
      || env.MAIL_FROM.endsWith('@example.com')) {
    throw new Error('Configure MAIL_FROM using your verified Cloudflare Email Sending domain.');
  }
  const q = JSON.stringify;
  // Load packaged defaults explicitly; a relative include would reload this generated file.
  const app = `include required(classpath("application.conf"))
mongodb.uri = "mongodb://localhost:27017/lishogi?replicaSet=rs0"
study.mongodb.uri = \${mongodb.uri}
puzzle.mongodb.uri = \${mongodb.uri}
oauth.mongodb.uri = \${mongodb.uri}
net.domain = ${q(origin.host)}
net.prodDomain = ${q(origin.host)}
net.base_url = ${q(origin.origin)}
net.asset.domain = ${q(origin.host)}
net.asset.base_url = ${q(origin.origin)}
net.socket.domains = [${q(origin.host)}]
net.email = ${q(env.MAIL_FROM)}
net.crawlable = false
play.http.secret.key = ${q(env.PLAY_SECRET)}
play.http.session.secure = true
play.http.session.httpOnly = true
user.password.bpass.secret = ${q(env.USER_PASSWORD_SECRET)}
security.password_reset.secret = ${q(env.PLAY_SECRET + ':password-reset')}
security.email_confirm.secret = ${q(env.PLAY_SECRET + ':email-confirm')}
security.email_confirm.enabled = true
security.email_change.secret = ${q(env.PLAY_SECRET + ':email-change')}
security.login_token.secret = ${q(env.PLAY_SECRET + ':login-token')}
storm.secret = ${q(env.PLAY_SECRET + ':storm')}
api.token = ${q(env.PLAY_SECRET + ':api')}
redis.uri = "redis://localhost:6379"
mailgun.api.url = "http://cf.mail"
mailgun.api.key = ${q(env.CONTAINER_CONTROL_TOKEN)}
mailgun.sender = ${q(env.MAIL_FROM)}
mailgun.reply_to = ${q(env.MAIL_FROM)}
shoginet.anon_mode = false
play.server.http.address = "127.0.0.1"
play.server.http.port = 9663
play.filters.hosts.allowed = [${q(origin.host)}, "localhost", "127.0.0.1"]
`;
  const socket = `include required(classpath("application.conf"))
http.port = 9664
mongo.uri = "mongodb://localhost:27017/lishogi?replicaSet=rs0"
study.mongo.uri = \${mongo.uri}
redis.uri = "redis://localhost:6379"
csrf.origin = ${q(origin.origin)}
netty.useEpoll = true
storm.secret = ${q(env.PLAY_SECRET + ':storm')}
`;
  const shoginet = {
    workers: 1, logger: 'info', endpoint: 'http://127.0.0.1:9663', key: env.SHOGINET_KEY,
    engines: {
      yaneuraou: {path: './engines/YaneuraOu-by-gcc', threads: 1, memory: 128},
      fairy: {path: './engines/fairy-stockfish', threads: 1, memory: 128},
    },
  };
  const nginx = `daemon off;
worker_processes 2;
pid /run/lishogi/nginx.pid;
error_log /dev/stderr warn;
events {worker_connections 2048;}
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log off;
  sendfile on;
  map $http_upgrade $connection_upgrade {default upgrade; '' close;}
  map $http_upgrade $application_port {default 9663; ~*websocket 9664;}
  server {
    listen 127.0.0.1:8082;
    server_name _;
    client_max_body_size 10m;
    proxy_set_header Host ${origin.host};
    proxy_set_header X-Forwarded-Host ${origin.host};
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $http_x_forwarded_for;
    proxy_set_header X-Real-IP $http_x_real_ip;
    location ^~ /_cf {return 404;}
    location ~ ^/assets/(?:_[^/]+/)?(.+)$ {
      alias /opt/lishogi/public-prod/$1;
      add_header Cross-Origin-Opener-Policy same-origin always;
      add_header Cross-Origin-Embedder-Policy require-corp always;
      add_header Cache-Control "public, max-age=3600";
    }
    location / {
      proxy_pass http://127.0.0.1:$application_port;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_buffering off;
      proxy_read_timeout 86400s;
      add_header Cross-Origin-Opener-Policy same-origin always;
      add_header Cross-Origin-Embedder-Policy require-corp always;
    }
  }
}
`;
  return {app, socket, shoginet, nginx};
}

export async function writeConfiguration(env) {
  const config = buildConfiguration(env);
  await mkdir('/run/lishogi', {recursive: true});
  await writeFile('/run/lishogi/application.conf', config.app, {mode: 0o600});
  await writeFile('/run/lishogi/socket.conf', config.socket, {mode: 0o600});
  await writeFile('/run/lishogi/nginx.conf', config.nginx);
  await writeFile('/opt/shoginet/config/local.json', JSON.stringify(config.shoginet), {mode: 0o600});
  return config;
}
