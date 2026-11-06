// 外部ブラウザ（OS のデフォルトブラウザ）で開いてよい URL かを確かめる。
// ログの文字列はエージェントの出力なので信用しない。shell.openExternal は file: やアプリ固有のスキームも
// 開けてしまうため、http(s) だけを通す。
function externalUrl(value) {
  if (typeof value !== 'string') return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
}

module.exports = { externalUrl };
