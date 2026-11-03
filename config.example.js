// 신구대조전 온라인(Supabase) 설정 예시
// - Vercel에서는 환경 변수(SUPABASE_URL, SUPABASE_ANON_KEY)로 config.js가 자동 생성되므로 이 파일을 고칠 필요가 없다.
// - 내 PC에서 온라인 제출을 시험하려면 이 파일을 config.js로 복사해 값을 넣는다. (config.js는 git에 올라가지 않음)
// - config.js가 없거나 값이 비어 있으면 도구는 오프라인 모드(.json 파일 주고받기)로 동작한다.
// - anon(공개) 키만 넣는다. service_role 키는 절대 넣지 않는다.
window.SINGU_CONFIG = {
  supabaseUrl: '',      // 예: 'https://abcdefghijk.supabase.co'
  supabaseAnonKey: '',  // Supabase > Project Settings > API Keys > publishable(또는 anon public) 키
};
