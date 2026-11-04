// 詳細の「ログ」タブを、Claude Desktop のようなチャットの形に並べ替える。
// - あなたの指示は右側の吹き出し、エージェントの返事は左側（アイコンと名前つき）
// - ツールの呼び出しと、その結果は1つの折りたたみにまとめる
// - システムのお知らせや完了・エラーは、会話の間に小さく挟む
// レンダラ（<script> で読み込む）とテスト（require）の両方から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatLog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const RESULT_KINDS = new Set(['tool_result', 'tool_error']);

  // エージェント側（左側）の発言として続けて並べるもの
  const isAgentSide = (it) => !!it && (it.type === 'assistant' || it.type === 'tool');

  /**
   * ログを1件足して、表示の項目（items）を更新する。
   * @returns {{ op: 'append' | 'replace', item: object }} append: 末尾に足す / replace: 末尾の項目を描き直す
   */
  function push(items, entry, defaultAgent) {
    const last = items[items.length - 1];
    // 末尾から続いているエージェント側のまとまりで、最後に分かっているエージェント
    const runAgent = isAgentSide(last) ? lastAgentOf(items) : null;
    // 返事のまとまりの最初（または Pipeline などでエージェントが替わったとき）だけ、アイコンと名前を出す
    const head = (agent) => !isAgentSide(last) || (!!agent && runAgent !== null && runAgent !== agent);
    if (RESULT_KINDS.has(entry.kind)) {
      // 直前のツール呼び出しの結果なら、その折りたたみの中に入れる
      if (last && last.type === 'tool' && !last.result) {
        last.result = entry;
        return { op: 'replace', item: last };
      }
      const item = { type: 'tool', entry: null, result: entry, agent: runAgent || defaultAgent || '', known: false, head: head(null) };
      items.push(item);
      return { op: 'append', item };
    }
    let item;
    if (entry.kind === 'user') item = { type: 'user', entry };
    else if (entry.kind === 'text') {
      // agent が付いていない返事は Claude のもの（Claude 以外は必ず agent を付けて記録している）
      const agent = entry.agent || 'claude';
      item = { type: 'assistant', entry, agent, known: true, head: head(agent) };
    } else if (entry.kind === 'tool') {
      // 古いログのツールには agent が付いていないので、まとまりのエージェント（なければカードのエージェント）を出す
      const agent = entry.agent || runAgent || defaultAgent || '';
      item = { type: 'tool', entry, result: null, agent, known: !!entry.agent, head: head(entry.agent || null) };
    } else item = { type: 'notice', entry };
    items.push(item);
    return { op: 'append', item };
  }

  // 末尾から続いているエージェント側のまとまりで、最後に分かっているエージェント（分からなければ null）
  function lastAgentOf(items) {
    for (let i = items.length - 1; i >= 0 && isAgentSide(items[i]); i--) {
      if (items[i].known) return items[i].agent;
    }
    return null;
  }

  function build(logs, defaultAgent) {
    const items = [];
    for (const e of logs || []) push(items, e, defaultAgent);
    return items;
  }

  return { build, push };
});
