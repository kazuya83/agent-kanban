// スケジューラと main.js のつなぎ。Electron なしで試せるように、IPC の引数の整え方と、
// デスクトップ通知を押したときの動きをここに置く

function needId(arg) {
  const id = arg && typeof arg === 'object' ? arg.id : arg;
  if (!id || typeof id !== 'string') throw new Error('スケジュールが指定されていません');
  return id;
}

// schedules:* のハンドラの中身。main.js から呼ぶ
function createScheduleApi({ scheduler, store }) {
  return {
    // 新しいスケジュールは、今開いているリポジトリのものにする（遠隔操作ではホストの今のリポジトリ）
    create(p) {
      const repoPath = store.settings.repoPath;
      if (!repoPath) throw new Error('先にリポジトリを開いてください');
      return scheduler.create({ ...(p || {}), repoPath });
    },
    update(p) {
      const { id, ...patch } = p || {};
      return scheduler.update(needId(id), patch);
    },
    delete(arg) {
      return scheduler.remove(needId(arg));
    },
    // start は「今すぐ実行」のときだけ true。指定がなければカードを作るだけにする（意図せずエージェントを動かさない）
    // card:create と同じく、作ったカードの ID を返す（カード全体はログも含むので、画面や遠隔へ流さない）
    run(p) {
      const cards = scheduler.run({ id: needId(p), start: !!p && p.start === true });
      return cards[0].id;
    },
  };
}

// デスクトップ通知を押したときに行うこと。リポジトリがない失敗など、カードのない通知（cardId: ''）もある
// 別のリポジトリのカードは今のタブに見えないので、そのリポジトリへ移ってから開く
function notificationClickPlan(n, { card, currentRepo, viewingHost } = {}) {
  const repo = (card && card.repoPath) || (n && n.repoPath) || '';
  return {
    toLocal: !!viewingHost && !!repo, // ホストのタブを見ているときは、このマシンのタブに移る
    openRepo: repo && repo !== currentRepo ? repo : '',
    focusId: card ? card.id : '',
  };
}

module.exports = { createScheduleApi, notificationClickPlan };
