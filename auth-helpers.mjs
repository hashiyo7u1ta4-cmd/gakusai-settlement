/** Browser-safe, side-effect-free helpers for OAuth and account state. */
export function accountKind(user){
  if(!user)return 'signed-out';
  // OAuth-linked users may carry an old is_anonymous flag in a cached session.
  // Prefer an actual Google provider/identity over that stale flag.
  if(user.identities?.some(i=>i.provider==='google')||user.app_metadata?.providers?.includes('google')||user.app_metadata?.provider==='google')return 'google';
  if(user.is_anonymous===true)return 'anonymous';
  return 'authenticated';
}
export function oauthReturnUrl(location){
  if(!/^https?:$/.test(location.protocol))throw Error('OAuthはlocalhostのHTTPまたはHTTPS経由で利用してください。');
  return location.origin+location.pathname;
}
/** Additional hints for provider configuration failures, never auto-logout/auto-merge. */
export function googleLinkProblemMessage(error){
  const message=String(error?.message||error||'');
  if(/manual.{0,25}link|link.{0,25}(disabled|not.enabled)|identity.linking.is.disabled/i.test(message))
    return 'Google連携が無効です。Supabase → Authentication → Sign In / Providers → User Signups の「Allow manual linking」をONにして保存してください。現在の匿名アカウントからはログアウトせず、再度「Googleに連携」を押してください。';
  if(/(already.linked|identity.already.exists|identity.*already.*(registered|exists|linked)|already.registered|already.in.use)/i.test(message))
    return '選択したGoogleアカウントは別のログインIDに紐付いています。自動的にアカウントを統合できません。現在の匿名アカウントからログアウトせず、参加者IDの引継ぎ方法を管理者と確認してください。';
  if(/provider.{0,25}(disabled|not.enabled)|unsupported.provider/i.test(message))
    return 'SupabaseのGoogleプロバイダーが有効になっていません。Authentication → Sign In / Providers → Google でClient IDとClient Secretを設定・保存してください。';
  if(/redirect.{0,25}(not.allowed|invalid|mismatch)|callback.{0,25}mismatch/i.test(message))
    return 'OAuthの戻り先URLが認可されていません。SupabaseのURL ConfigurationとGoogle CloudのリダイレクトURIを確認してください。';
  return null;
}
