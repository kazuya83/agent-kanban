// タスクスケジューラの画面（一覧・詳細・編集）。
// 画面の部品（openModal・agentFieldHtml・runBusy など）は renderer.js のものを使う。
// このファイルを読み込む時点では renderer.js がまだ動いていないことがあるので、それらは関数の中でだけ触る。
//
// 境界: window.SchedulerView = { render(), openEditor({ fromCard }) }
//   render()                 #schedulerView を今のボードの内容で描き直す（開いている詳細も）
//   openEditor({ fromCard }) 新規のスケジュールを作る画面を開く（fromCard があれば、そのタスクの内容をコピーする）
//   openEditor({ schedule }) そのスケジュールを編集する画面を開く
/* global api, icon, esc, $, state, ScheduleModel, openModal, closeModal, runBusy, toast, chooseRepo, select,
   agentFieldHtml, bindAgentField, modelFieldHtml, updateModelField, readModelField, renderSkillSlot,
   agentLabel, isRelayRef, isCustomRef, pipelineOfRef, findCustomAgent, relayFlowInfo, RELAY_PREFIX, CUSTOM_PREFIX */
(function (root) {
  const i18n = typeof module === 'object' && module.exports ? require('./i18n.js') : root.I18n;
  function tr(key, vars) {
    if (i18n) return i18n.tr(key, vars);
    return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : key;
  }
  const WEEKDAYS = ScheduleModel.WEEKDAY_NAMES;
  const RULE_KINDS = ['once', 'hourly', 'daily', 'weekly', 'monthly'];
  function ruleKindLabel(kind) {
    if (kind === 'once') return tr('1回だけ');
    if (kind === 'hourly') return tr('毎時');
    if (kind === 'daily') return tr('毎日');
    if (kind === 'weekly') return tr('毎週');
    if (kind === 'monthly') return tr('毎月');
    return kind;
  }
  function runLabel(status) {
    if (status === 'ok') return tr('実行');
    if (status === 'skipped' || status === 'missed') return tr('見送り');
    if (status === 'failed') return tr('失敗');
    return status || '';
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const toTime = (v) => (v ? new Date(v).getTime() : NaN);

  // 「2026/11/06 09:00」の形（ローカル時刻）。日付がないときは空文字
  function fmtDateTime(v) {
    const t = toTime(v);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  // <input type="datetime-local"> の値の形
  function toLocalInput(v) {
    const t = toTime(v);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // カードのエージェントの指定を、スケジュールに持たせる値に戻す（Pipeline・競争・カスタムエージェントは、カードの agent だけでは分からない）
  function agentRefOfCard(c) {
    if (c.compete) return 'compete';
    if (c.relay) return c.relay.pipeline && c.relay.pipeline.id ? RELAY_PREFIX + c.relay.pipeline.id : 'relay';
    if (c.persona && c.persona.id) return CUSTOM_PREFIX + c.persona.id;
    return c.agent || '';
  }
  // タスクの内容からスケジュールの下書きを作る（添付ファイルはコピーしない）
  function draftFromCard(c) {
    const agent = agentRefOfCard(c);
    const single = agent !== 'compete' && agent !== 'relay' && !isRelayRef(agent) && !isCustomRef(agent);
    return {
      title: (c.compete && c.compete.title) || c.title || '',
      prompt: c.prompt || '',
      skill: c.skill || null,
      agent,
      model: single ? c.model || '' : '',
      readOnly: !!c.readOnly,
      sourceCardId: c.id,
    };
  }

  /**
   * 繰り返しの入力欄の値から rule を作る
   * @param {{ kind: string, at?: string, time?: string, minute?: string, weekdays?: number[], day?: string, prevAt?: any }} f
   *   prevAt: 編集前の日時（1回だけのスケジュールを、日時を変えずに編集するときは、過ぎていても受け付ける）
   * @returns {{ rule?: object, error?: string }}
   */
  function ruleFromForm(f, now = Date.now()) {
    if (!RULE_KINDS.includes(f.kind)) return { error: tr('繰り返しの種類を選んでください') };
    if (f.kind === 'once') {
      const at = new Date(String(f.at || '')).getTime();
      if (!Number.isFinite(at)) return { error: tr('実行する日時を入れてください') };
      if (at <= now && toLocalInput(f.prevAt) !== f.at) return { error: tr('実行する日時に、過去の日時は指定できません') };
      return { rule: { kind: 'once', at } };
    }
    if (f.kind === 'hourly') {
      const m = String(f.minute ?? '').trim();
      if (!/^\d{1,2}$/.test(m) || Number(m) > 59) return { error: tr('分は 0〜59 の数字で入れてください') };
      return { rule: { kind: 'hourly', minute: Number(m) } };
    }
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(f.time || ''));
    if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) return { error: tr('時刻を入れてください') };
    const time = { hour: Number(tm[1]), minute: Number(tm[2]) };
    if (f.kind === 'daily') return { rule: { kind: 'daily', ...time } };
    if (f.kind === 'weekly') {
      const weekdays = [...new Set(f.weekdays || [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
      if (!weekdays.length) return { error: tr('曜日を1つ以上選んでください') };
      return { rule: { kind: 'weekly', ...time, weekdays } };
    }
    const day = String(f.day ?? '').trim();
    if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31) return { error: tr('日は 1〜31 の数字で入れてください') };
    return { rule: { kind: 'monthly', ...time, day: Number(day) } };
  }

  // 新しいスケジュールの繰り返しの初期値（毎日 9:00。1回だけに切り替えたときは、次のちょうどの時刻）
  function defaultRule(now = Date.now()) {
    const d = new Date(now);
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return { kind: 'daily', hour: 9, minute: 0, weekdays: [new Date(now).getDay()], day: new Date(now).getDate(), at: d.getTime() };
  }

  // 1回だけのスケジュールは、日時が過ぎていると再開しても動かない
  function canResume(s, now = Date.now()) {
    if (!s.rule || s.rule.kind !== 'once') return true;
    return toTime(s.rule.at) > now;
  }

  const schedules = () => (Array.isArray(state.board.schedules) ? state.board.schedules : []);
  const findSchedule = (id) => schedules().find((s) => s.id === id) || null;
  // 動いているものを次の実行が近い順に、そのあとに止めているものを並べる
  function sortedSchedules(list) {
    const next = (s) => (Number.isFinite(toTime(s.nextRunAt)) ? toTime(s.nextRunAt) : Infinity);
    return [...list].sort((a, b) => !!b.enabled - !!a.enabled || next(a) - next(b) || toTime(a.createdAt) - toTime(b.createdAt));
  }
  const ruleText = (s) => (s.rule ? ScheduleModel.describeRule(s.rule) : '');

  // スケジュールのエージェントの指定を、画面に出す名前にする
  function agentName(ref) {
    if (!ref) return tr('設定の既定');
    if (ref === 'compete') return tr('競争');
    if (ref === 'relay' || isRelayRef(ref)) {
      const p = pipelineOfRef(ref);
      return p ? tr('Pipeline「{name}」', { name: p.name || 'Pipeline' }) : tr('Pipeline（見つかりません）');
    }
    if (isCustomRef(ref)) {
      const ca = findCustomAgent(ref);
      return ca ? ca.name : tr('カスタムエージェント（見つかりません）');
    }
    return agentLabel(ref);
  }

  // ---------------- 一覧 ----------------

  function cardHtml(s) {
    const tags = [];
    if (!s.enabled) tags.push(`<span class="sched-tag off">${tr('停止中')}</span>`);
    if (s.lastStatus === 'failed') tags.push(`<span class="sched-tag err">${icon('alert')}${tr('前回は失敗')}</span>`);
    return `<button type="button" class="sched-card ${s.enabled ? '' : 'off'}" data-sched-id="${esc(s.id)}">
      <span class="sched-card-title">${esc(s.title)}</span>
      <span class="sched-card-row"><span class="muted">${tr('最終実行日')}</span><span>${esc(fmtDateTime(s.lastRunAt) || tr('未実行'))}</span></span>
      <span class="sched-card-rule muted">${esc(ruleText(s))}</span>
      ${tags.length ? `<span class="sched-tags">${tags.join('')}</span>` : ''}
    </button>`;
  }

  function listHtml() {
    if (!state.board.settings.repoPath) {
      return `<div class="empty-state"><h2>${tr('まずリポジトリを選んでください')}</h2><p>${tr('スケジュールはリポジトリごとに管理します。リポジトリを開くと、ここにそのリポジトリのスケジュールが出ます。')}</p><button class="btn primary" data-sched-act="repo">${tr('リポジトリを選ぶ')}</button></div>`;
    }
    const list = sortedSchedules(schedules());
    return `<div class="sched-head">
        <div><h2>${icon('calendar')}${tr('タスクスケジューラ')}</h2><p class="muted small">${tr('決めた日時に、カンバンにタスクを作って開始します。アプリを起動しているあいだだけ動きます。')}</p></div>
        <button class="btn primary" data-sched-act="new">${icon('plus')}${tr('新しいスケジュール')}</button>
      </div>
      ${list.length ? `<div class="sched-grid">${list.map(cardHtml).join('')}</div>` : `<div class="col-empty">${tr('スケジュールはまだありません。「新しいスケジュール」か、カンバンのタスク詳細の「スケジュール登録」から作れます。')}</div>`}`;
  }

  // 同じ内容なら描き直さない（ボードは頻繁に更新されるので、スクロールやフォーカスが飛ばないように）
  let lastListHtml = null;
  function render() {
    const box = $('schedulerView');
    if (box) {
      const html = listHtml();
      if (html !== lastListHtml) box.innerHTML = lastListHtml = html;
      box.onclick = onListClick;
    }
    drawDetail();
  }

  function onListClick(e) {
    const act = e.target.closest('[data-sched-act]');
    if (act) {
      if (act.dataset.schedAct === 'repo') chooseRepo();
      else openEditor();
      return;
    }
    const c = e.target.closest('[data-sched-id]');
    if (c) openDetail(c.dataset.schedId);
  }

  // ---------------- 詳細 ----------------

  function openDetail(id) {
    openModal('<div id="schedDetail"></div>', () => {
      const wrap = $('schedDetail');
      wrap.dataset.id = id;
      wrap.onclick = onDetailClick;
      drawDetail();
    });
  }

  function runRowHtml(r) {
    const exists = r.cardId && state.board.cards.some((c) => c.id === r.cardId);
    const link = exists ? `<button type="button" class="btn small ghost" data-sched-card="${esc(r.cardId)}">${tr('カードを開く')}</button>` : r.cardId ? `<span class="muted small">${tr('カードは削除済み')}</span>` : '';
    return `<li class="sched-run">
      <span class="sched-run-at">${esc(fmtDateTime(r.at))}</span>
      <span class="sched-run-st st-${esc(r.status)}">${esc(runLabel(r.status))}</span>
      <span class="sched-run-msg muted" title="${esc(r.message || '')}">${esc(r.message || '')}</span>
      ${link}
    </li>`;
  }

  function nextRunText(s) {
    if (!s.enabled) return canResume(s) ? tr('停止中') : tr('予定なし');
    return fmtDateTime(s.nextRunAt) || tr('予定なし');
  }

  function detailHtml(s) {
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const resumable = canResume(s);
    const toggle = s.enabled
      ? `<button class="btn ghost" data-sched-do="toggle">${tr('停止')}</button>`
      : `<button class="btn ghost" data-sched-do="toggle" ${resumable ? '' : `disabled title="${esc(tr('日時が過ぎています。「編集」で日時を変えてください'))}"`}>${tr('再開')}</button>`;
    return `<h2>${icon('calendar')}${esc(s.title)}</h2>
      <dl class="sched-info">
        ${row(tr('繰り返し'), esc(ruleText(s)))}
        ${row(tr('次回の実行'), esc(nextRunText(s)))}
        ${row(tr('最終実行日'), esc(fmtDateTime(s.lastRunAt) || tr('未実行')))}
        ${row(tr('エージェント'), esc(agentName(s.agent)) + (s.model ? ` <span class="muted">/ ${esc(s.model)}</span>` : ''))}
        ${row(tr('スキル'), s.skill ? `<code>/${esc(s.skill)}</code>` : tr('なし'))}
        ${row(tr('動かし方'), [s.readOnly ? tr('ソースを変更しない') : '', s.catchUp ? tr('起動後に1回だけ追いつく') : ''].filter(Boolean).map(esc).join('・') || tr('通常'))}
      </dl>
      ${s.lastStatus === 'failed' && s.lastError ? `<p class="sched-error">${icon('alert')}${esc(s.lastError)}</p>` : ''}
      <h3 class="sched-h3">${tr('指示内容')}</h3>
      <pre class="sched-prompt">${esc(s.prompt)}</pre>
      <h3 class="sched-h3">${tr('実行履歴')}</h3>
      ${(s.runs || []).length ? `<ul class="sched-runs">${s.runs.map(runRowHtml).join('')}</ul>` : `<p class="muted small">${tr('まだ実行していません')}</p>`}
      <div class="modal-actions sched-actions">
        <button class="btn danger" data-sched-do="delete">${tr('削除')}</button>
        <span class="spacer"></span>
        <button class="btn ghost" data-sched-do="close">${tr('閉じる')}</button>
        <button class="btn ghost" data-sched-do="edit">${tr('編集')}</button>
        ${toggle}
        <button class="btn ghost" data-sched-do="task" title="${esc(tr('カンバンにタスクを作ります。開始はしません'))}">${tr('タスクだけ作成')}</button>
        <button class="btn primary" data-sched-do="run" title="${esc(tr('カンバンにタスクを作って、すぐに開始します'))}">${tr('今すぐ実行')}</button>
      </div>`;
  }

  let lastDetailHtml = null;
  function drawDetail() {
    const wrap = $('schedDetail');
    if (!wrap) {
      lastDetailHtml = null;
      return;
    }
    const s = findSchedule(wrap.dataset.id);
    // 別の PC で消された・タブを切り替えたなどで見つからなくなったら閉じる
    if (!s) {
      lastDetailHtml = null;
      closeModal();
      return;
    }
    const html = detailHtml(s);
    if (html !== lastDetailHtml || !wrap.innerHTML) wrap.innerHTML = lastDetailHtml = html;
  }

  async function onDetailClick(e) {
    const cardBtn = e.target.closest('[data-sched-card]');
    if (cardBtn) {
      closeModal();
      select(cardBtn.dataset.schedCard); // select() がカンバンの画面に戻す
      return;
    }
    const b = e.target.closest('[data-sched-do]');
    if (!b || b.disabled) return;
    const s = findSchedule($('schedDetail').dataset.id);
    if (!s) return;
    const act = b.dataset.schedDo;
    if (act === 'close') closeModal();
    else if (act === 'edit') openEditor({ schedule: s });
    else if (act === 'run') await runBusy(tr('タスクを作って開始しています…'), () => api.runSchedule({ id: s.id, start: true }), tr('タスクを作って開始しました'));
    else if (act === 'task') await runBusy(tr('タスクを作成しています…'), () => api.runSchedule({ id: s.id, start: false }), tr('カンバンにタスクを作成しました'));
    else if (act === 'toggle') await runBusy(tr('保存しています…'), () => api.updateSchedule({ id: s.id, enabled: !s.enabled }), s.enabled ? tr('停止しました') : tr('再開しました'));
    else if (act === 'delete') {
      if (!confirm(tr('スケジュール「{title}」を削除しますか？\n作成済みのタスクは残ります。', { title: s.title }))) return;
      let done = false;
      await runBusy(tr('削除しています…'), async () => {
        await api.deleteSchedule(s.id);
        done = true;
      }, tr('削除しました'));
      if (done) closeModal();
    }
  }

  // ---------------- 作成・編集 ----------------

  function ruleFieldsHtml(r) {
    const hm = `${pad2(r.hour ?? 9)}:${pad2(r.minute ?? 0)}`;
    const on = new Set(r.weekdays || []);
    const days = WEEKDAYS.map((w, i) => `<label class="sched-wd"><input type="checkbox" id="schedWd${i}" ${on.has(i) ? 'checked' : ''} /><span>${w}</span></label>`).join('');
    return `<label class="field"><span>${tr('繰り返し')}</span><select id="schedKind">${RULE_KINDS.map((k) => `<option value="${k}" ${k === r.kind ? 'selected' : ''}>${ruleKindLabel(k)}</option>`).join('')}</select></label>
      <label class="field" id="schedAtBox"><span>${tr('実行する日時')}</span><input type="datetime-local" id="schedAt" value="${esc(toLocalInput(r.at))}" /></label>
      <label class="field" id="schedMinuteBox"><span>${tr('毎時の何分に実行するか（0〜59）')}</span><input type="number" id="schedMinute" min="0" max="59" value="${esc(r.minute ?? 0)}" /></label>
      <div class="field" id="schedWeekBox"><span>${tr('曜日（複数選べます）')}</span><div class="sched-wds">${days}</div></div>
      <label class="field" id="schedDayBox"><span>${tr('毎月の何日に実行するか（1〜31）')}</span><input type="number" id="schedDay" min="1" max="31" value="${esc(r.day ?? 1)}" /><small>${tr('月の日数より大きいときは、その月の末日に実行します')}</small></label>
      <label class="field" id="schedTimeBox"><span>${tr('時刻（この PC の時刻）')}</span><input type="time" id="schedTime" value="${esc(hm)}" /></label>`;
  }
  function showRuleFields() {
    const k = $('schedKind').value;
    const show = { schedAtBox: k === 'once', schedMinuteBox: k === 'hourly', schedWeekBox: k === 'weekly', schedDayBox: k === 'monthly', schedTimeBox: k === 'daily' || k === 'weekly' || k === 'monthly' };
    for (const [id, on] of Object.entries(show)) $(id).classList.toggle('hidden', !on);
  }
  function readRule(prevAt) {
    return ruleFromForm({
      kind: $('schedKind').value,
      at: $('schedAt').value,
      time: $('schedTime').value,
      minute: $('schedMinute').value,
      day: $('schedDay').value,
      weekdays: WEEKDAYS.flatMap((_, i) => ($(`schedWd${i}`).checked ? [i] : [])),
      prevAt,
    });
  }

  // ソースを変更しないタスクで使えない組み合わせは、無人で失敗する前にここで止める
  function readOnlyError(agent, readOnly) {
    if (!readOnly) return '';
    if (agent === 'compete') return tr('ソースを変更しないタスクでは、競争は使えません。ほかのエージェントを選んでください');
    if (isRelayRef(agent) && relayFlowInfo((pipelineOfRef(agent) || {}).flow).pars) return tr('ソースを変更しないタスクでは、並列のあるPipelineは使えません。ほかのエージェントを選んでください');
    return '';
  }

  /**
   * スケジュールの作成・編集の画面を開く
   * @param {{ fromCard?: object, schedule?: object }} [opts]
   */
  function openEditor({ fromCard, schedule } = {}) {
    if (!state.board.settings.repoPath) return chooseRepo();
    const base = defaultRule();
    const draft = schedule || (fromCard ? draftFromCard(fromCard) : { title: '', prompt: '', skill: state.board.settings.defaultSkill || null, agent: undefined, model: '', readOnly: false });
    const rule = { ...base, ...(schedule ? schedule.rule : {}) };
    const files = fromCard ? (fromCard.attachments || []).length : 0;
    openModal(
      `<h2>${icon('calendar')}${schedule ? tr('スケジュールを編集') : tr('新しいスケジュール')}</h2>
       ${fromCard ? `<p class="muted small">${tr('タスク「{title}」の内容をコピーして登録します。元のタスクはそのまま残ります。', { title: esc(fromCard.title) })}${files ? tr('添付ファイル（{n} 件）はコピーしません。', { n: files }) : ''}</p>` : ''}
       <label class="field"><span>${tr('タスク名（省略すると指示の1行目）')}</span><input id="schedTitle" value="${esc(draft.title)}" /></label>
       ${agentFieldHtml('sched', draft.agent)}
       <p id="schedAgentLost" class="field-note warn hidden"></p>
       ${modelFieldHtml('sched', draft.model || '')}
       <div class="field"><span>${tr('エージェントへの指示')}</span><div id="schedSkill" class="skill-slot"></div><textarea id="schedPrompt" rows="8" placeholder="${esc(tr('毎回エージェントに頼むことを具体的に書いてください。'))}">${esc(draft.prompt)}</textarea></div>
       ${ruleFieldsHtml(rule)}
       <label class="check" title="${esc(tr('SQL を作るだけ・調べるだけなど、ソースコードを変えないタスクにします'))}"><input type="checkbox" id="schedReadOnly" ${draft.readOnly ? 'checked' : ''} /> ${tr('ソースを変更しない（調べもの・SQL などの生成だけ）')}</label>
       <label class="check" title="${esc(tr('アプリを閉じていた・スリープしていたなどで10分より遅れたときは、ふつうは見送って次回へ進みます。チェックを付けると、起動してから1回だけ実行します'))}"><input type="checkbox" id="schedCatchUp" ${draft.catchUp ? 'checked' : ''} /> ${tr('時刻を過ぎていたら、起動後に1回だけ追いつく')}</label>
       <div class="modal-actions"><button class="btn ghost" id="schedCancel">${tr('キャンセル')}</button><button class="btn primary" id="schedOk">${schedule ? tr('保存') : tr('登録')}（Ctrl/⌘ + Enter）</button></div>`,
      () => {
        const sel = $('schedAgent');
        // 元の Pipeline が消された・使わない設定になったなどで選べないと、別のものに黙って置き換わるので知らせる
        const lost = draft.agent && draft.agent !== sel.value && !(draft.agent === 'relay' && isRelayRef(sel.value));
        if (lost) {
          $('schedAgentLost').textContent = tr('元の指定（{name}）は今は選べないので、別のものを選んでいます。確かめてから保存してください。', { name: agentName(draft.agent) });
          $('schedAgentLost').classList.remove('hidden');
        }
        bindAgentField('sched', (v) => updateModelField('sched', v));
        let skill = draft.skill || null;
        const drawSkill = () => renderSkillSlot('schedSkill', skill, (v) => ((skill = v), drawSkill()));
        drawSkill();
        $('schedKind').onchange = showRuleFields;
        showRuleFields();
        const leave = () => (schedule ? openDetail(schedule.id) : closeModal());
        const submit = async () => {
          const prompt = $('schedPrompt').value.trim();
          if (!prompt) return toast(tr('エージェントへの指示を入れてください'));
          const { rule: nextRule, error } = readRule(schedule && schedule.rule ? schedule.rule.at : undefined);
          if (error) return toast(error);
          const agent = sel.value;
          const readOnly = $('schedReadOnly').checked;
          const roErr = readOnlyError(agent, readOnly);
          if (roErr) return toast(roErr);
          const data = {
            title: $('schedTitle').value.trim(), // 空なら本体が指示の1行目から作る
            prompt,
            skill,
            agent,
            model: readModelField('sched', agent) || '', // 空でも送る（Pipeline に変えたときに古いモデルを残さない）
            readOnly,
            catchUp: $('schedCatchUp').checked,
            rule: nextRule,
          };
          let done = false;
          await runBusy(tr('スケジュールを保存しています…'), async () => {
            if (schedule) await api.updateSchedule({ id: schedule.id, ...data });
            else await api.createSchedule({ ...data, enabled: true, sourceCardId: draft.sourceCardId });
            done = true;
          }, schedule ? tr('保存しました') : tr('スケジュールを登録しました'));
          if (done) leave();
        };
        $('schedOk').onclick = submit;
        $('schedCancel').onclick = leave;
        $('schedPrompt').addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        });
      },
    );
  }

  root.SchedulerView = { render, openEditor, fmtDateTime, agentRefOfCard, draftFromCard, ruleFromForm, sortedSchedules, canResume };
})(typeof self !== 'undefined' ? self : this);
