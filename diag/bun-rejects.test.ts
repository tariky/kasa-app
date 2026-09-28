// DIJAGNOSTIKA (privremeno): da li bun test na Windowsu zaglavi kad
// expect(...).rejects/resolves čeka obećanje koje razrješava čitanje stdout-a
// podprocesa koji odgovori sa zakašnjenjem (storno timeout u ugovornim testovima).
import { test, expect, afterAll } from 'bun:test';

const dijete = Bun.spawn([process.execPath, '-e', `
  const d = new TextDecoder(); let buf = '';
  for await (const c of Bun.stdin.stream()) {
    buf += d.decode(c); let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const ms = Number(buf.slice(0, i)); buf = buf.slice(i + 1);
      setTimeout(() => process.stdout.write('odgovor\\n'), ms);
    }
  }
`], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });

const cekaju: Array<() => void> = [];
(async () => {
  const d = new TextDecoder();
  for await (const c of dijete.stdout) for (const l of d.decode(c).split('\n')) if (l) cekaju.shift()?.();
})();

function zahtjev(ms: number, odbij: boolean): Promise<string> {
  const p = new Promise<void>(r => cekaju.push(r));
  dijete.stdin.write(`${ms}\n`);
  dijete.stdin.flush();
  return p.then(() => { if (odbij) throw new Error('odbijeno'); return 'ok'; });
}

afterAll(() => dijete.kill());

for (const ms of [1, 60, 300]) {
  test(`try-catch ${ms} ms`, async () => {
    let g: unknown;
    try { await zahtjev(ms, true); } catch (e) { g = e; }
    expect(String(g)).toContain('odbijeno');
  });
  test(`rejects ${ms} ms`, async () => {
    await expect(zahtjev(ms, true)).rejects.toThrow('odbijeno');
  });
  test(`resolves ${ms} ms`, async () => {
    await expect(zahtjev(ms, false)).resolves.toBe('ok');
  });
}
