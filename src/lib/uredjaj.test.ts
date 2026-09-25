import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { IOREG, regPutanja, uredjajId } from './uredjaj';

test('reg.exe se zove apsolutnom putanjom iz SystemRoot, s fallbackom C:\\Windows', () => {
  expect(regPutanja({ SystemRoot: 'D:\\WIN' })).toBe('D:\\WIN\\System32\\reg.exe');
  expect(regPutanja({})).toBe('C:\\Windows\\System32\\reg.exe');
  expect(regPutanja({ SystemRoot: '' })).toBe('C:\\Windows\\System32\\reg.exe');
  expect(IOREG).toBe('/usr/sbin/ioreg');
});

test('ID uređaja je XXXX-XXXX-XXXX i stabilan', () => {
  expect(uredjajId()).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  expect(uredjajId()).toBe(uredjajId());
});

test.if(process.platform === 'darwin')('macOS: isti ID kao IOPlatformUUID iz /usr/sbin/ioreg', () => {
  const uuid = execFileSync(IOREG, ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)![1];
  const h = createHash('sha256').update(`pazar:${uuid}`).digest('hex').slice(0, 12).toUpperCase();
  expect(uredjajId()).toBe(h.match(/.{4}/g)!.join('-'));
});
