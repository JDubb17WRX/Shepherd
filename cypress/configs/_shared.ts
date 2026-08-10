// Shared node event setup used by multiple Cypress configs
export function setupCommonNodeEvents(on: any, config: any) {
  const runtimeValues = new Map<string, unknown>();

  const decodeBase32 = (secret: string): Buffer => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const normalizedSecret = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
    if (normalizedSecret === '' || !/^[A-Z2-7]+$/.test(normalizedSecret)) {
      throw new Error('TOTP secret must be valid Base32');
    }

    const bytes: number[] = [];
    let bits = 0;
    let value = 0;
    for (const character of normalizedSecret) {
      value = (value << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((value >>> bits) & 0xff);
        value &= (1 << bits) - 1;
      }
    }

    return Buffer.from(bytes);
  };

  on('task', {
    setRuntimeValue({ key, value }: { key: string; value: unknown }) {
      runtimeValues.set(key, value);
      return null;
    },
    getRuntimeValue(key: string) {
      return runtimeValues.get(key) ?? null;
    },
    generateTotp({ secret, timestamp }: { secret: string; timestamp?: number }) {
      const crypto = require('node:crypto');
      const counter = BigInt(Math.floor((timestamp ?? Date.now()) / 30000));
      const counterBytes = Buffer.alloc(8);
      counterBytes.writeBigUInt64BE(counter);
      const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBytes).digest();
      const offset = digest[digest.length - 1] & 0x0f;
      const binary = digest.readUInt32BE(offset) & 0x7fffffff;

      return String(binary % 1000000).padStart(6, '0');
    },
    async resetTwoFactorReplay({ username }: { username: string }) {
      const mysql = require('mysql2/promise');
      const baseUrl = new URL(config.baseUrl || 'http://127.0.0.1/');
      const inferredDatabasePort = baseUrl.port === '8081' ? 3308 : baseUrl.port === '8080' ? 3307 : 3306;
      const databasePort = Number(config.env.taskDbPort || inferredDatabasePort);
      const connection = await mysql.createConnection({
        host: config.env.taskDbHost || '127.0.0.1',
        port: databasePort,
        user: config.env['db.user'] || 'churchcrm',
        password: config.env['db.password'] || 'changeme',
        database: config.env['db.name'] || 'churchcrm',
      });
      try {
        const [result] = await connection.execute(
          'UPDATE user_usr SET usr_TwoFactorAuthLastKeyTimestamp = NULL WHERE usr_UserName = ?',
          [username],
        );
        return result.affectedRows;
      } finally {
        await connection.end();
      }
    },
  });

  // cypress-terminal-report logs printer for CI debugging
  try {
    const installLogsPrinter = require('cypress-terminal-report/src/installLogsPrinter');
    installLogsPrinter(on, {
      outputRoot: 'cypress/logs',
      outputTarget: {
        'cypress-terminal-report.txt': 'txt',
        'cypress-terminal-report.json': 'json'
      },
      printLogsToConsole: 'onFail',
      printLogsToFile: 'always'
    });
  } catch (err) {
    // ignore optional logging integration errors in local environments
  }

  // Register download verification tasks if available
  try {
    const { verifyDownloadTasks } = require('cy-verify-downloads');
    on('task', verifyDownloadTasks);
  } catch (err) {
    // optional dependency may be missing in some environments
  }

  // Common browser launch options
  on('before:browser:launch', (browser: any, launchOptions: any) => {
    if (browser.name === 'chrome') {
      launchOptions.args.push('--disable-dev-shm-usage');
    }
    return launchOptions;
  });

  return config;
}
