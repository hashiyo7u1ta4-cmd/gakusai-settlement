/** Browser-safe, side-effect-free helpers for OAuth and account state. */
export function accountKind(user){
  if(!user)return 'signed-out';
  if(user.is_anonymous===true)return 'anonymous';
  if(user.identities?.some(i=>i.provider==='google')||user.app_metadata?.providers?.includes('google')||user.app_metadata?.provider==='google')return 'google';
  return 'authenticated';
}
export function oauthReturnUrl(location){
  if(!/^https?:$/.test(location.protocol))throw Error('OAuthはlocalhostのHTTPまたはHTTPS経由で利用してください。');
  return location.origin+location.pathname;
}
