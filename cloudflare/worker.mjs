import {Container, ContainerProxy} from '@cloudflare/containers';
import {loadBackup, publishBackup, publicRequest} from './persistence.mjs';
import {handleMail} from './mail.mjs';
import {waitForStartup, startupResponse} from './readiness.mjs';

export {ContainerProxy};

const RELEASE = 'standard2-startup-20261014-v2';

export class LishogiServer extends Container {
  defaultPort = 8080;
  sleepAfter = '24h';
  enableInternet = true;
  bootPromise;
  backupPromise;
  startupStage = 'idle';
  applicationReady = false;
  startupWaitMilliseconds = 10_000;

  constructor(ctx, env) {
    super(ctx, env);
    console.info('Lishogi runtime release:', RELEASE);
    this.envVars = {
      PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
      CONTAINER_CONTROL_TOKEN: env.CONTAINER_CONTROL_TOKEN || '',
      PLAY_SECRET: env.PLAY_SECRET || '',
      USER_PASSWORD_SECRET: env.USER_PASSWORD_SECRET || '',
      SHOGINET_KEY: env.SHOGINET_KEY || '',
      MAIL_FROM: env.MAIL_FROM || '',
    };
  }

  stage(value) {
    this.startupStage = value;
    console.info('Lishogi startup stage:', value, RELEASE);
  }

  control(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-container-control', this.env.CONTAINER_CONTROL_TOKEN);
    return this.containerFetch(new Request(`http://container/_cf/${path}`, {...init, headers}));
  }

  async ensureReady() {
    if (!this.env.CONTAINER_CONTROL_TOKEN || !this.env.PLAY_SECRET
        || !this.env.USER_PASSWORD_SECRET || !this.env.SHOGINET_KEY) {
      this.stage('missing-secrets');
      throw new Error('Required secrets have not been configured.');
    }
    if (!this.bootPromise) {
      this.bootPromise = this.boot().catch(error => {
        this.bootPromise = undefined;
        this.applicationReady = false;
        console.error('Lishogi startup failed at stage:', this.startupStage, RELEASE, error.message);
        this.stage('failed');
        throw error;
      });
      // Keep startup independent of the first browser request or disconnect.
      this.ctx.waitUntil(this.bootPromise.catch(() => {}));
    }
    await this.bootPromise;
  }

  async boot() {
    this.stage('container-port');
    await this.startAndWaitForPorts({
      ports: [8080], cancellationOptions: {waitInterval: 1000, instanceGetTimeoutMS: 120_000, portReadyTimeoutMS: 180_000},
    });
    this.stage('container-status');
    const statusResponse = await this.control('status');
    if (!statusResponse.ok) throw new Error('Container control service is unavailable.');
    const status = await statusResponse.json();
    if (!status.ready) {
      this.stage('backup-load');
      const backup = await loadBackup(this.env.BACKUPS);
      const previouslyInitialized = await this.ctx.storage.get('initialized');
      if (!backup && previouslyInitialized) {
        throw new Error('A previously initialized server has no committed backup. Refusing to create an empty database.');
      }
      if (backup) {
        this.stage('database-restore');
        const restored = await this.control('restore', {
          method: 'POST', body: backup.archive.body,
          headers: {'content-type': 'application/gzip', 'x-backup-sha256': backup.manifest.sha256},
        });
        if (!restored.ok) throw new Error(`Database restore failed: HTTP ${restored.status}`);
      }
      this.stage('application-initialize');
      const started = await this.control('initialize', {method: 'POST'});
      if (!started.ok) throw new Error(`Application startup failed: HTTP ${started.status}`);
    }
    if (!await this.ctx.storage.get('initialized')) {
      this.stage('initial-backup');
      await this.saveBackup();
      await this.ctx.storage.put('initialized', true);
    }
    console.info('Lishogi startup and initial backup completed:', RELEASE);
    this.stage('checkpoint-schedule');
    await this.armCheckpoint();
    this.applicationReady = true;
    this.stage('ready');
  }

  backupInterval() {
    const seconds = Number(this.env.BACKUP_INTERVAL_SECONDS || 60);
    return Math.min(300, Math.max(15, Number.isFinite(seconds) ? seconds : 60)) * 1000;
  }

  async saveBackup() {
    if (!this.backupPromise) {
      this.backupPromise = (async () => {
        const response = await this.control('backup', {method: 'POST'});
        console.info('Lishogi backup archive response:', response.status, RELEASE);
        let manifest;
        try {
          manifest = await publishBackup(this.env.BACKUPS, response);
          console.info('Lishogi R2 backup committed:', manifest.size, RELEASE);
        } catch (error) {
          throw new Error(`R2 backup publication failed (${RELEASE}): ${error.message}`, {cause: error});
        }
        await this.ctx.storage.put('lastBackup', manifest);
        const history = await this.ctx.storage.get('backupHistory') || [];
        const keys = [...history.filter(key => key !== manifest.key), manifest.key];
        await this.ctx.storage.put('backupHistory', keys.slice(-10));
        if (keys.length > 10) await this.env.BACKUPS.delete(keys.slice(0, -10));
        return manifest;
      })().finally(() => {this.backupPromise = undefined;});
    }
    return this.backupPromise;
  }

  async armCheckpoint() {
    this.deleteSchedules('checkpoint');
    await this.schedule(this.backupInterval() / 1000, 'checkpoint');
  }

  async checkpoint() {
    try {
      await this.ensureReady();
      await this.saveBackup();
      await this.renewActivityTimeout();
    } finally {
      await this.armCheckpoint();
    }
  }

  async onActivityExpired() {
    // Lishogi runs background timers and active games. Keep the full server alive.
    await this.saveBackup();
    await this.renewActivityTimeout();
  }

  async onStop() {this.bootPromise = undefined; this.applicationReady = false; this.stage('stopped');}
  async onError() {this.bootPromise = undefined; this.applicationReady = false; this.stage('container-error');}

  async fetch(request) {
    const forwarded = publicRequest(request, this.env.PUBLIC_ORIGIN);
    if (!forwarded) return new Response('Not found', {status: 404});
    if (new URL(request.url).pathname === '/healthz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', {status: 405, headers: {allow: 'GET, HEAD'}});
      }
      return Response.json({ready: this.applicationReady, stage: this.startupStage, release: RELEASE}, {
        status: this.applicationReady ? 200 : 503, headers: {'cache-control': 'no-store'},
      });
    }
    if (!await waitForStartup(this.ensureReady(), this.startupWaitMilliseconds)) {
      return startupResponse(this.startupStage, RELEASE);
    }
    return this.containerFetch(forwarded);
  }
}

LishogiServer.outboundByHost = {'cf.mail': handleMail};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_cf')) return new Response('Not found', {status: 404});
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (url.host !== origin.host) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Use the canonical site address.', {status: 421});
      }
      url.host = origin.host;
      url.protocol = origin.protocol;
      return Response.redirect(url.toString(), 308);
    }
    try {
      const id = env.LISHOGI.idFromName('primary-v1');
      return await env.LISHOGI.get(id, {locationHint: 'apac'}).fetch(request);
    } catch (error) {
      console.error('Lishogi request failed:', error.message);
      return startupResponse('request-failed', RELEASE);
    }
  },
};
