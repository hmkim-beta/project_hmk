// Vercel 배포용 빌드: 배포할 파일만 dist/에 모으고, 환경 변수로 config.js를 만든다.
// - HTML은 저장소에 이미 빌드되어 있다(python src/build.py). 여기서는 복사만 한다.
// - 환경 변수 SUPABASE_URL, SUPABASE_ANON_KEY가 없으면 빈 설정 → 오프라인(.json 파일) 모드로 동작.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'dist');
const PAGES = ['index.html', '교범비교도구.html', '수정제안폼.html'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const page of PAGES) {
  if (!existsSync(join(root, page))) throw new Error(`${page}가 없습니다. 먼저 python src/build.py를 실행해 커밋하세요.`);
  cpSync(join(root, page), join(out, page));
}
// 공유하기 쉬운 영문 주소: /author, /propose (cleanUrls)
cpSync(join(root, '교범비교도구.html'), join(out, 'author.html'));
cpSync(join(root, '수정제안폼.html'), join(out, 'propose.html'));
cpSync(join(root, 'samples'), join(out, 'samples'), { recursive: true });

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
// 비밀 키가 웹 페이지에 들어가는 사고 방지
const jwtRole = (() => { try { return JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64').toString()).role || ''; } catch { return ''; } })();
if (jwtRole === 'service_role' || key.startsWith('sb_secret_')) {
  throw new Error('SUPABASE_ANON_KEY에 비밀(service_role/secret) 키가 들어 있습니다. anon(publishable) 키를 넣으세요.');
}
writeFileSync(
  join(out, 'config.js'),
  `// Vercel 빌드에서 자동 생성 (${new Date().toISOString()})\nwindow.SINGU_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }, null, 2)};\n`,
);

console.log(`dist/ 준비 완료: ${PAGES.join(', ')}, samples/, config.js (온라인 제출 ${url && key ? '켜짐' : '꺼짐 — 환경 변수 없음'})`);
