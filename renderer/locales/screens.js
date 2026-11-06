(typeof module === 'object' && module.exports ? require('../i18n.js') : I18n).add({
  "作成したらすぐに開始する": {
    "en": "Start as soon as it is created",
    "es": "Empezar en cuanto se cree",
    "fr": "Démarrer dès la création",
    "zh": "创建后立即开始"
  },
  "工程": {
    "en": "Step",
    "es": "Paso",
    "fr": "Étape",
    "zh": "步骤"
  },
  "1つのエージェントが作業する工程": {
    "en": "A step where one agent does the work",
    "es": "Un paso en el que un agente hace el trabajo",
    "fr": "Une étape où un agent fait le travail",
    "zh": "由一个代理完成工作的步骤"
  },
  "分岐（if）": {
    "en": "Branch (if)",
    "es": "Bifurcación (if)",
    "fr": "Branchement (if)",
    "zh": "分支（if）"
  },
  "直前の工程のエージェントが書いた判定の値で、行き先を分けます": {
    "en": "The route depends on the result value written by the agent of the previous step",
    "es": "La ruta depende del valor escrito por el agente del paso anterior",
    "fr": "La destination dépend de la valeur écrite par l’agent de l’étape précédente",
    "zh": "根据上一步代理写下的判定值选择去向"
  },
  "並列": {
    "en": "Parallel",
    "es": "Paralelo",
    "fr": "Parallèle",
    "zh": "并行"
  },
  "枝ごとに別の worktree で、工程を同時に動かします": {
    "en": "Each branch runs steps at the same time in its own worktree",
    "es": "Cada rama ejecuta los pasos a la vez en su propio worktree",
    "fr": "Chaque branche exécute les étapes en même temps dans son propre worktree",
    "zh": "每个分支在各自的 worktree 中同时运行步骤"
  },
  "合流": {
    "en": "Join",
    "es": "Unión",
    "fr": "Jonction",
    "zh": "汇合"
  },
  "並列の枝がすべて終わるのを待ち、変更をマージします": {
    "en": "Wait until every parallel branch finishes, then merge the changes",
    "es": "Espera a que terminen todas las ramas y fusiona los cambios",
    "fr": "Attend que toutes les branches finissent, puis fusionne les changements",
    "zh": "等所有并行分支结束后合并更改"
  },
  "終了": {
    "en": "End",
    "es": "Fin",
    "fr": "Fin",
    "zh": "结束"
  },
  "Pipelineを終えてレビュー列へ": {
    "en": "Finish the Pipeline and move to review",
    "es": "Termina el Pipeline y pasa a revisión",
    "fr": "Termine le Pipeline et passe en revue",
    "zh": "结束 Pipeline 并进入评审列"
  },
  "カスタムエージェントが見つかりません": {
    "en": "Custom agent not found",
    "es": "No se encuentra el agente personalizado",
    "fr": "Agent personnalisé introuvable",
    "zh": "找不到自定义代理"
  },
  "{icon}{name}（{agent}{model}）{off}": {
    "en": "{icon}{name} ({agent}{model}){off}",
    "es": "{icon}{name} ({agent}{model}){off}",
    "fr": "{icon}{name} ({agent}{model}){off}",
    "zh": "{icon}{name}（{agent}{model}）{off}"
  },
  "（使わない設定）": {
    "en": " (disabled)",
    "es": " (desactivado)",
    "fr": " (désactivé)",
    "zh": "（未启用）"
  },
  "Pipelineのフローチャート": {
    "en": "Pipeline flowchart",
    "es": "Diagrama del Pipeline",
    "fr": "Organigramme du Pipeline",
    "zh": "Pipeline 流程图"
  },
  "ノードはドラッグで動かせます。何もないところをドラッグすると、スクロールできます。右上のボタンか、⌘（Ctrl）を押しながらのスクロール・ピンチで拡大・縮小できます。ノードの下の丸（出口）から別のノードへドラッグすると、線をつなげます。前のノードへ戻る線を引くとループになり、戻る上限を決められます。ノードや線を選んで Delete キーで消せます。": {
    "en": "Drag nodes to move them. Drag empty space to scroll. Use the buttons at the top right, or scroll or pinch while holding ⌘ (Ctrl), to zoom. Drag from the dot under a node to another node to connect them. A line back to an earlier node is a loop, and you can set how many times it may run. Select a node or line and press Delete to remove it.",
    "es": "Arrastra los nodos para moverlos. Arrastra el espacio vacío para desplazar. Usa los botones de arriba a la derecha, o desplaza o pellizca con ⌘ (Ctrl), para ampliar. Arrastra desde el punto bajo un nodo hasta otro para conectarlos. Una línea hacia un nodo anterior es un bucle y puedes limitar las veces. Selecciona un nodo o una línea y pulsa Delete para borrarlos.",
    "fr": "Faites glisser les nœuds pour les déplacer. Faites glisser le vide pour faire défiler. Utilisez les boutons en haut à droite, ou le défilement ou le pincement avec ⌘ (Ctrl), pour zoomer. Faites glisser le point sous un nœud vers un autre pour les relier. Une ligne vers un nœud précédent est une boucle, avec une limite de passages. Sélectionnez un nœud ou une ligne et appuyez sur Delete pour le supprimer.",
    "zh": "拖动节点可移动。拖动空白处可滚动。用右上角按钮，或按住 ⌘（Ctrl）滚动或捏合来缩放。从节点下方的圆点拖到另一个节点即可连线。连回前面节点的线是循环，可设置次数上限。选中节点或线后按 Delete 删除。"
  },
  "作りたいフローや直したいところを文章で書けます（{agent} が組み立てます）。例: Codex で実装して Claude でレビューし、直すところがあれば実装に戻す（3回まで）": {
    "en": "Describe the flow you want or what to change ({agent} will build it). Example: implement with Codex, review with Claude, and return to implementation if changes are needed (up to 3 times)",
    "es": "Describe el flujo que quieres o lo que hay que cambiar ({agent} lo arma). Ejemplo: implementar con Codex, revisar con Claude y volver a la implementación si hay cambios (hasta 3 veces)",
    "fr": "Décrivez le flux voulu ou ce qu’il faut changer ({agent} le construit). Exemple : implémenter avec Codex, relire avec Claude, et revenir à l’implémentation s’il faut corriger (3 fois au plus)",
    "zh": "用文字写出想要的流程或要改的地方（由 {agent} 组装）。例：用 Codex 实现，用 Claude 评审，若需修改则回到实现（最多 3 次）"
  },
  "⌘（Ctrl）＋Enter でも送れます": {
    "en": "You can also send with ⌘ (Ctrl) + Enter",
    "es": "También puedes enviar con ⌘ (Ctrl) + Enter",
    "fr": "Vous pouvez aussi envoyer avec ⌘ (Ctrl) + Entrée",
    "zh": "也可以用 ⌘（Ctrl）+ Enter 发送"
  },
  "AIで反映": {
    "en": "Apply with AI",
    "es": "Aplicar con IA",
    "fr": "Appliquer avec l’IA",
    "zh": "用 AI 应用"
  },
  "元に戻す": {
    "en": "Undo",
    "es": "Deshacer",
    "fr": "Annuler",
    "zh": "还原"
  },
  "キャンセル": {
    "en": "Cancel",
    "es": "Cancelar",
    "fr": "Annuler",
    "zh": "取消"
  },
  "保存": {
    "en": "Save",
    "es": "Guardar",
    "fr": "Enregistrer",
    "zh": "保存"
  },
  "{n}. {label}": {
    "en": "{n}. {label}",
    "es": "{n}. {label}",
    "fr": "{n}. {label}",
    "zh": "{n}. {label}"
  },
  "（名前なし）": {
    "en": "(untitled)",
    "es": "(sin nombre)",
    "fr": "(sans nom)",
    "zh": "（未命名）"
  },
  "判定の値で分ける": {
    "en": "Branch on the result value",
    "es": "Separar según el valor",
    "fr": "Séparer selon la valeur",
    "zh": "按判定值分流"
  },
  "同時に動かす": {
    "en": "Run at the same time",
    "es": "Ejecutar a la vez",
    "fr": "Exécuter en même temps",
    "zh": "同时运行"
  },
  "すべて待ってマージ": {
    "en": "Wait for all, then merge",
    "es": "Esperar a todos y fusionar",
    "fr": "Tout attendre, puis fusionner",
    "zh": "全部等待后合并"
  },
  "ドラッグして、つなぐ先のノードで離す": {
    "en": "Drag and release on the node to connect",
    "es": "Arrastra y suelta en el nodo de destino",
    "fr": "Faites glisser et relâchez sur le nœud à relier",
    "zh": "拖到要连接的节点上松开"
  },
  "＋それ以外": {
    "en": "+ otherwise",
    "es": "+ si no",
    "fr": "+ sinon",
    "zh": "＋否则"
  },
  "それ以外": {
    "en": "otherwise",
    "es": "si no",
    "fr": "sinon",
    "zh": "否则"
  },
  "期待値なし": {
    "en": "no expected value",
    "es": "sin valor esperado",
    "fr": "aucune valeur attendue",
    "zh": "无期望值"
  },
  "↺ {n}回まで": {
    "en": "↺ up to {n}",
    "es": "↺ hasta {n}",
    "fr": "↺ jusqu’à {n}",
    "zh": "↺ 最多 {n} 次"
  },
  "直すところ（{n}）": {
    "en": "Issues to fix ({n})",
    "es": "Puntos a corregir ({n})",
    "fr": "Points à corriger ({n})",
    "zh": "需要修改（{n}）"
  },
  "✓ このフローで Pipeline を動かせます": {
    "en": "✓ This flow can run a Pipeline",
    "es": "✓ Este flujo puede ejecutar un Pipeline",
    "fr": "✓ Ce flux peut lancer un Pipeline",
    "zh": "✓ 此流程可以运行 Pipeline"
  },
  "ノードや線を選ぶと、ここで中身を変えられます。": {
    "en": "Select a node or a line to edit it here.",
    "es": "Selecciona un nodo o una línea para editarlo aquí.",
    "fr": "Sélectionnez un nœud ou une ligne pour le modifier ici.",
    "zh": "选择节点或连线后，可在这里修改内容。"
  },
  "<b>分岐（if）</b>: 直前の工程のエージェントに、返事の最後へ <code>[[RESULT:値]]</code> を書いてもらい、線ごとの期待値と比べて行き先を選びます。3つ以上に分けられます。": {
    "en": "<b>Branch (if)</b>: the agent of the previous step writes <code>[[RESULT:value]]</code> at the end of the reply. Each line’s expected value chooses the route. You can split into three or more.",
    "es": "<b>Bifurcación (if)</b>: el agente del paso anterior escribe <code>[[RESULT:valor]]</code> al final. El valor esperado de cada línea elige la ruta. Se puede dividir en tres o más.",
    "fr": "<b>Branchement (if)</b> : l’agent de l’étape précédente écrit <code>[[RESULT:valeur]]</code> à la fin. La valeur attendue de chaque ligne choisit la destination. On peut en faire trois ou plus.",
    "zh": "<b>分支（if）</b>：上一步的代理在回复末尾写下 <code>[[RESULT:值]]</code>，再与每条线的期望值比较来选择去向。可以分成三条以上。"
  },
  "<b>並列 → 合流</b>: 枝ごとに別の worktree で同時に動かし、すべての枝が終わったらマージして先へ進みます。コンフリクトしたら止めて知らせます。": {
    "en": "<b>Parallel → join</b>: each branch runs in its own worktree. When all branches finish, their changes are merged. A conflict stops the Pipeline and reports it.",
    "es": "<b>Paralelo → unión</b>: cada rama corre en su propio worktree. Al terminar todas, se fusionan los cambios. Un conflicto detiene el Pipeline y lo avisa.",
    "fr": "<b>Parallèle → jonction</b> : chaque branche tourne dans son worktree. Quand toutes ont fini, les changements sont fusionnés. Un conflit arrête le Pipeline et le signale.",
    "zh": "<b>并行 → 汇合</b>：每个分支在各自的 worktree 中同时运行，全部结束后合并。若发生冲突则停止并通知。"
  },
  "<b>ループ</b>: 前のノードへ戻る線を引くと、戻る上限の回数まで繰り返します。": {
    "en": "<b>Loop</b>: a line back to an earlier node repeats until its limit.",
    "es": "<b>Bucle</b>: una línea hacia un nodo anterior se repite hasta el límite.",
    "fr": "<b>Boucle</b> : une ligne vers un nœud précédent se répète jusqu’à la limite.",
    "zh": "<b>循环</b>：连回前面节点的线会重复，直到达到次数上限。"
  },
  "このノードを消す": {
    "en": "Delete this node",
    "es": "Eliminar este nodo",
    "fr": "Supprimer ce nœud",
    "zh": "删除此节点"
  },
  "（見つからないカスタムエージェント）": {
    "en": "(missing custom agent)",
    "es": "(agente personalizado ausente)",
    "fr": "(agent personnalisé manquant)",
    "zh": "（找不到的自定义代理）"
  },
  "カスタムエージェント": {
    "en": "Custom agents",
    "es": "Agentes personalizados",
    "fr": "Agents personnalisés",
    "zh": "自定义代理"
  },
  "エージェント": {
    "en": "Agent",
    "es": "Agente",
    "fr": "Agent",
    "zh": "代理"
  },
  "カスタムエージェント「{name}」のモデル（{model}）とプロフィールで動かします。{desc}": {
    "en": "Runs with the model ({model}) and profile of the custom agent “{name}”. {desc}",
    "es": "Se ejecuta con el modelo ({model}) y el perfil del agente personalizado «{name}». {desc}",
    "fr": "S’exécute avec le modèle ({model}) et le profil de l’agent personnalisé « {name} ». {desc}",
    "zh": "使用自定义代理“{name}”的模型（{model}）和设定运行。{desc}"
  },
  "設定の既定": {
    "en": "the configured default",
    "es": "el valor predeterminado",
    "fr": "la valeur par défaut",
    "zh": "设置中的默认值"
  },
  "このカスタムエージェントは見つかりません。選び直してください。": {
    "en": "This custom agent was not found. Choose another.",
    "es": "No se encuentra este agente personalizado. Elige otro.",
    "fr": "Cet agent personnalisé est introuvable. Choisissez-en un autre.",
    "zh": "找不到此自定义代理。请重新选择。"
  },
  "モデル（空なら設定の既定）": {
    "en": "Model (blank uses the configured default)",
    "es": "Modelo (vacío: el predeterminado)",
    "fr": "Modèle (vide : la valeur par défaut)",
    "zh": "模型（留空则用设置中的默认值）"
  },
  "例: {model}": {
    "en": "e.g. {model}",
    "es": "p. ej. {model}",
    "fr": "p. ex. {model}",
    "zh": "例：{model}"
  },
  "工程の名前": {
    "en": "Step name",
    "es": "Nombre del paso",
    "fr": "Nom de l’étape",
    "zh": "步骤名称"
  },
  "例: 実装": {
    "en": "e.g. Implement",
    "es": "p. ej. Implementar",
    "fr": "p. ex. Implémenter",
    "zh": "例：实现"
  },
  "担当の説明": {
    "en": "What this step does",
    "es": "Qué hace este paso",
    "fr": "Rôle de cette étape",
    "zh": "本步骤的说明"
  },
  "例: 前の工程の変更をレビューして直す": {
    "en": "e.g. Review the previous step and fix it",
    "es": "p. ej. Revisar el paso anterior y corregirlo",
    "fr": "p. ex. Relire l’étape précédente et la corriger",
    "zh": "例：评审并修改上一步的更改"
  },
  "この工程のあとは分岐「{label}」です。エージェントに、返事の最後へ判定の値（{values}）を書いてもらいます。": {
    "en": "This step is followed by the branch “{label}”. The agent should write a result value ({values}) at the end of the reply.",
    "es": "Después de este paso está la bifurcación «{label}». El agente debe escribir un valor ({values}) al final de la respuesta.",
    "fr": "Cette étape est suivie du branchement « {label} ». L’agent doit écrire une valeur ({values}) à la fin de la réponse.",
    "zh": "此步骤之后是分支“{label}”。请让代理在回复末尾写下判定值（{values}）。"
  },
  "まだありません": {
    "en": "none yet",
    "es": "aún no hay",
    "fr": "aucune pour l’instant",
    "zh": "还没有"
  },
  "分岐の名前": {
    "en": "Branch name",
    "es": "Nombre de la bifurcación",
    "fr": "Nom du branchement",
    "zh": "分支名称"
  },
  "例: レビューの結果": {
    "en": "e.g. Review result",
    "es": "p. ej. Resultado de la revisión",
    "fr": "p. ex. Résultat de la revue",
    "zh": "例：评审结果"
  },
  "判定すること（エージェントに伝えます）": {
    "en": "What to judge (told to the agent)",
    "es": "Qué debe juzgar (se le dice al agente)",
    "fr": "Ce qu’il faut juger (dit à l’agent)",
    "zh": "要判定的内容（会告诉代理）"
  },
  "例: テストがすべて通り、直すところがないか": {
    "en": "e.g. Whether all tests pass and nothing needs fixing",
    "es": "p. ej. Si todas las pruebas pasan y no hay nada que corregir",
    "fr": "p. ex. Si tous les tests passent et qu’il n’y a rien à corriger",
    "zh": "例：测试是否全部通过、是否没有需要修改的地方"
  },
  "行き先ごとに線を引き、線を選んで「期待値」と「条件の説明」を決めます。どの期待値にも合わないときの行き先は、線の「どれにも合わないとき」で決めます（なければ止まって知らせます）。": {
    "en": "Draw a line for each route, then set its expected value and explanation. The line marked “when nothing matches” is used when no expected value matches (otherwise the Pipeline stops and reports it).",
    "es": "Dibuja una línea por destino y define su valor esperado y la explicación. La línea «cuando no coincide ninguno» se usa si ningún valor coincide (si no hay, se detiene y avisa).",
    "fr": "Tracez une ligne par destination, puis son valeur attendue et son explication. La ligne « si aucune ne correspond » sert quand aucune valeur ne correspond (sinon le Pipeline s’arrête et le signale).",
    "zh": "为每个去向连一条线，再设置“期望值”和“条件说明”。都不匹配时走标为“都不匹配”的线（如果没有，就会停止并通知）。"
  },
  "（期待値なし）": {
    "en": "(no expected value)",
    "es": "(sin valor esperado)",
    "fr": "(aucune valeur attendue)",
    "zh": "（无期望值）"
  },
  "名前": {
    "en": "Name",
    "es": "Nombre",
    "fr": "Nom",
    "zh": "名称"
  },
  "線を2本以上出し、それぞれ工程につなぎます。枝の最後は同じ合流につないでください。枝ごとに別の worktree（このタスクのブランチから分けたもの）で同時に動かします。": {
    "en": "Draw at least two lines, each to a step. End every branch at the same join. Each branch runs at the same time in its own worktree (branched from this task).",
    "es": "Saca al menos dos líneas, cada una a un paso. Termina todas las ramas en la misma unión. Cada rama corre a la vez en su propio worktree (separado de la rama de esta tarea).",
    "fr": "Sortez au moins deux lignes, chacune vers une étape. Terminez chaque branche sur la même jonction. Chaque branche tourne en même temps dans son worktree (dérivé de la branche de cette tâche).",
    "zh": "至少拉出两条线，分别连到步骤。各分支的末尾要连到同一个汇合。每个分支在各自的 worktree（从本任务的分支分出）中同时运行。"
  },
  "並列の枝の最後をここにつなぎます。すべての枝が終わったら、枝の変更を順にマージして先へ進みます。コンフリクトしたら止めて知らせます。": {
    "en": "Connect the end of each parallel branch here. When every branch has finished, their changes are merged in order. A conflict stops the Pipeline and reports it.",
    "es": "Conecta aquí el final de cada rama paralela. Cuando terminen todas, sus cambios se fusionan en orden. Un conflicto detiene el Pipeline y lo avisa.",
    "fr": "Reliez ici la fin de chaque branche parallèle. Quand toutes ont fini, leurs changements sont fusionnés dans l’ordre. Un conflit arrête le Pipeline et le signale.",
    "zh": "把各并行分支的末尾连到这里。全部分支结束后，按顺序合并更改。若发生冲突则停止并通知。"
  },
  "Pipelineはここから始まります。線を1本、最初の工程へつないでください。": {
    "en": "The Pipeline starts here. Draw one line to the first step.",
    "es": "El Pipeline empieza aquí. Traza una línea hasta el primer paso.",
    "fr": "Le Pipeline commence ici. Tracez une ligne vers la première étape.",
    "zh": "Pipeline 从这里开始。请连一条线到第一个步骤。"
  },
  "ここに来たら Pipeline を終えて、レビュー列に入れて知らせます。": {
    "en": "Reaching here finishes the Pipeline, moves it to review, and notifies you.",
    "es": "Al llegar aquí, el Pipeline termina, pasa a revisión y te avisa.",
    "fr": "Arriver ici termine le Pipeline, le place en revue et vous prévient.",
    "zh": "到达这里后，Pipeline 结束，进入评审列并通知你。"
  },
  "期待値（エージェントが書く <code>[[RESULT:値]]</code> の値）": {
    "en": "Expected value (the value in <code>[[RESULT:value]]</code> written by the agent)",
    "es": "Valor esperado (el valor de <code>[[RESULT:valor]]</code> que escribe el agente)",
    "fr": "Valeur attendue (la valeur de <code>[[RESULT:valeur]]</code> écrite par l’agent)",
    "zh": "期望值（代理所写 <code>[[RESULT:值]]</code> 中的值）"
  },
  "例: ok / ng / retry": {
    "en": "e.g. ok / ng / retry",
    "es": "p. ej. ok / ng / retry",
    "fr": "p. ex. ok / ng / retry",
    "zh": "例：ok / ng / retry"
  },
  "条件の説明（どんなときにこの値を書くか）": {
    "en": "Explanation (when the agent should write this value)",
    "es": "Explicación (cuándo debe escribir este valor)",
    "fr": "Explication (quand écrire cette valeur)",
    "zh": "条件说明（什么时候写这个值）"
  },
  "例: 直すところがない": {
    "en": "e.g. Nothing to fix",
    "es": "p. ej. No hay nada que corregir",
    "fr": "p. ex. Rien à corriger",
    "zh": "例：没有需要修改的地方"
  },
  "どれにも合わないとき（値を書かなかったときも）、この線へ進む": {
    "en": "When nothing matches (including when no value was written), follow this line",
    "es": "Si ninguno coincide (también si no escribió valor), seguir esta línea",
    "fr": "Si aucune ne correspond (y compris sans valeur), suivre cette ligne",
    "zh": "都不匹配时（包括没有写值），走这条线"
  },
  "戻る上限（この線を通れる回数。1〜{max}回）": {
    "en": "Loop limit (how many times this line may be used, 1–{max})",
    "es": "Límite del bucle (veces que se puede usar esta línea, 1–{max})",
    "fr": "Limite de boucle (nombre de passages de cette ligne, 1–{max})",
    "zh": "返回上限（这条线可经过的次数，1–{max} 次）"
  },
  "前のノードへ戻る線（ループ）です。上限に達したら Pipeline を終えて、レビュー列に入れて知らせます（並列の枝の中なら、そこまでの変更で合流します）。": {
    "en": "This line loops back to an earlier node. At the limit, the Pipeline finishes, moves to review, and notifies you (inside a parallel branch, it joins with the changes so far).",
    "es": "Esta línea vuelve a un nodo anterior. Al llegar al límite, el Pipeline termina, pasa a revisión y avisa (dentro de una rama paralela, se une con los cambios hechos).",
    "fr": "Cette ligne revient à un nœud précédent. À la limite, le Pipeline se termine, passe en revue et vous prévient (dans une branche parallèle, elle rejoint avec les changements déjà faits).",
    "zh": "这是回到前面节点的线（循环）。达到上限后，Pipeline 结束并进入评审列通知你（若在并行分支中，则带着到此为止的更改去汇合）。"
  },
  "線": {
    "en": "Line",
    "es": "Línea",
    "fr": "Ligne",
    "zh": "连线"
  },
  "この線を消す": {
    "en": "Delete this line",
    "es": "Eliminar esta línea",
    "fr": "Supprimer cette ligne",
    "zh": "删除此连线"
  },
  "分岐": {
    "en": "Branch",
    "es": "Bifurcación",
    "fr": "Branchement",
    "zh": "分支"
  },
  "作りたいフローや直したいところを書いてください": {
    "en": "Describe the flow you want or what to change",
    "es": "Describe el flujo que quieres o lo que hay que cambiar",
    "fr": "Décrivez le flux voulu ou ce qu’il faut changer",
    "zh": "请写下想要的流程或要修改的地方"
  },
  "{agent} がフローを組み立てています…": {
    "en": "{agent} is building the flow…",
    "es": "{agent} está armando el flujo…",
    "fr": "{agent} construit le flux…",
    "zh": "{agent} 正在组装流程…"
  },
  "反映しました。中身を確かめて「保存」を押してください（まだ保存していません）": {
    "en": "Applied. Check it and press Save (nothing is saved yet)",
    "es": "Aplicado. Revísalo y pulsa Guardar (aún no está guardado)",
    "fr": "Appliqué. Vérifiez et appuyez sur Enregistrer (ce n’est pas encore enregistré)",
    "zh": "已应用。请确认内容后按“保存”（尚未保存）"
  },
  "フローチャートの変更を保存せずに閉じますか？": {
    "en": "Close without saving flowchart changes?",
    "es": "¿Cerrar sin guardar los cambios del diagrama?",
    "fr": "Fermer sans enregistrer les changements du diagramme ?",
    "zh": "不保存流程图的更改就关闭吗？"
  },
  "工程「{label}」のモデル名に使えない文字が入っています: {model}": {
    "en": "The model name for step “{label}” contains characters that are not allowed: {model}",
    "es": "El nombre del modelo del paso «{label}» tiene caracteres no permitidos: {model}",
    "fr": "Le nom de modèle de l’étape « {label} » contient des caractères interdits : {model}",
    "zh": "步骤“{label}”的模型名含有不能使用的字符：{model}"
  },
  "工程「{label}」の {who} は使えません（{why}）。このままだとPipelineを始められません。保存しますか？": {
    "en": "Step “{label}” cannot use {who} ({why}). The Pipeline cannot start like this. Save anyway?",
    "es": "El paso «{label}» no puede usar {who} ({why}). Así el Pipeline no puede empezar. ¿Guardar de todos modos?",
    "fr": "L’étape « {label} » ne peut pas utiliser {who} ({why}). Le Pipeline ne pourra pas démarrer. Enregistrer quand même ?",
    "zh": "步骤“{label}”无法使用 {who}（{why}）。这样无法开始 Pipeline。仍要保存吗？"
  },
  "使わない設定です": {
    "en": "it is disabled in settings",
    "es": "está desactivado en los ajustes",
    "fr": "il est désactivé dans les réglages",
    "zh": "在设置中未启用"
  },
  "開始": {
    "en": "Start",
    "es": "Inicio",
    "fr": "Début",
    "zh": "开始"
  },
  "工程{n}": {
    "en": "Step {n}",
    "es": "Paso {n}",
    "fr": "Étape {n}",
    "zh": "步骤{n}"
  },
  "工程{n}へ": {
    "en": "to step {n}",
    "es": "al paso {n}",
    "fr": "vers l’étape {n}",
    "zh": "前往步骤{n}"
  },
  "工程{n}に戻る": {
    "en": "back to step {n}",
    "es": "volver al paso {n}",
    "fr": "retour à l’étape {n}",
    "zh": "返回步骤{n}"
  },
  "分岐「{label}」": {
    "en": "Branch “{label}”",
    "es": "Bifurcación «{label}»",
    "fr": "Branchement « {label} »",
    "zh": "分支“{label}”"
  },
  "並列「{label}」": {
    "en": "Parallel “{label}”",
    "es": "Paralelo «{label}»",
    "fr": "Parallèle « {label} »",
    "zh": "并行“{label}”"
  },
  "{name}の枝の中に、もう1つの並列は置けません": {
    "en": "Another parallel cannot be placed inside a branch of {name}",
    "es": "No se puede poner otro paralelo dentro de una rama de {name}",
    "fr": "Un autre parallèle ne peut pas être placé dans une branche de {name}",
    "zh": "不能在 {name} 的分支里再放一个并行"
  },
  "{name}の枝は、終了ではなく合流につないでください": {
    "en": "Connect each branch of {name} to a join, not to an end",
    "es": "Conecta cada rama de {name} a una unión, no a un fin",
    "fr": "Reliez chaque branche de {name} à une jonction, pas à une fin",
    "zh": "请把 {name} 的分支连到汇合，而不是结束"
  },
  "{name}の枝が、別々の合流につながっています": {
    "en": "The branches of {name} connect to different joins",
    "es": "Las ramas de {name} llegan a uniones distintas",
    "fr": "Les branches de {name} arrivent à des jonctions différentes",
    "zh": "{name} 的分支连到了不同的汇合"
  },
  "{name}の枝が、合流につながっていません": {
    "en": "A branch of {name} is not connected to a join",
    "es": "Una rama de {name} no está conectada a una unión",
    "fr": "Une branche de {name} n’est pas reliée à une jonction",
    "zh": "{name} 的分支没有连到汇合"
  },
  "{name}の枝は、すべて同じ合流につないでください": {
    "en": "Connect every branch of {name} to the same join",
    "es": "Conecta todas las ramas de {name} a la misma unión",
    "fr": "Reliez toutes les branches de {name} à la même jonction",
    "zh": "请把 {name} 的所有分支连到同一个汇合"
  },
  "{name}の枝どうしが、途中でつながっています（枝は合流までそれぞれ別にしてください）": {
    "en": "Branches of {name} connect to each other before the join (keep them separate until the join)",
    "es": "Las ramas de {name} se conectan entre sí antes de la unión (manténlas separadas hasta la unión)",
    "fr": "Les branches de {name} se rejoignent avant la jonction (gardez-les séparées jusqu’à la jonction)",
    "zh": "{name} 的分支在中途连在了一起（在汇合之前请保持各自分开）"
  },
  "{name}の枝の外から、枝の中の「{label}」へ線が入っています": {
    "en": "A line from outside a branch of {name} enters “{label}” inside the branch",
    "es": "Una línea de fuera de una rama de {name} entra en «{label}» dentro de la rama",
    "fr": "Une ligne extérieure à une branche de {name} entre dans « {label} » à l’intérieur",
    "zh": "有一条来自 {name} 分支之外的线进入了分支内的“{label}”"
  },
  "フローがありません": {
    "en": "There is no flowchart",
    "es": "No hay diagrama",
    "fr": "Il n’y a pas d’organigramme",
    "zh": "没有流程图"
  },
  "開始のノードがありません": {
    "en": "There is no start node",
    "es": "No hay nodo de inicio",
    "fr": "Il n’y a pas de nœud de début",
    "zh": "没有开始节点"
  },
  "工程のノードが1つもありません": {
    "en": "There are no step nodes",
    "es": "No hay ningún nodo de paso",
    "fr": "Il n’y a aucun nœud d’étape",
    "zh": "没有任何步骤节点"
  },
  "{type}「{label}」": {
    "en": "{type} “{label}”",
    "es": "{type} «{label}»",
    "fr": "{type} « {label} »",
    "zh": "{type}“{label}”"
  },
  "{type}「{label}」へ": {
    "en": "to {type} “{label}”",
    "es": "a {type} «{label}»",
    "fr": "vers {type} « {label} »",
    "zh": "前往{type}“{label}”"
  },
  "開始からは、線を1本だけ出してください": {
    "en": "Draw exactly one line from the start",
    "es": "Traza una sola línea desde el inicio",
    "fr": "Sortez exactement une ligne du début",
    "zh": "请从开始只拉出一条线"
  },
  "開始の次は、工程にしてください": {
    "en": "The node after the start must be a step",
    "es": "El nodo después del inicio debe ser un paso",
    "fr": "Le nœud après le début doit être une étape",
    "zh": "开始之后必须是步骤"
  },
  "{name}から先の線がありません（最後なら終了につないでください）": {
    "en": "{name} has no line onward (connect it to an end if it is the last)",
    "es": "{name} no tiene línea de salida (conéctalo a un fin si es el último)",
    "fr": "{name} n’a pas de ligne vers la suite (reliez-le à une fin s’il est le dernier)",
    "zh": "{name} 没有往下的线（如果是最后，请连到结束）"
  },
  "{name}からは、線を1本だけ出してください（行き先を分けるときは分岐、同時に動かすときは並列を使います）": {
    "en": "Draw exactly one line from {name} (use a branch to split, or a parallel to run at the same time)",
    "es": "Traza una sola línea desde {name} (usa una bifurcación para separar, o un paralelo para ejecutar a la vez)",
    "fr": "Sortez exactement une ligne de {name} (un branchement pour séparer, un parallèle pour exécuter en même temps)",
    "zh": "请从 {name} 只拉出一条线（要分流用分支，要同时运行用并行）"
  },
  "{name}から先の線がありません": {
    "en": "{name} has no line onward",
    "es": "{name} no tiene línea de salida",
    "fr": "{name} n’a pas de ligne vers la suite",
    "zh": "{name} 没有往下的线"
  },
  "{name}から出る線に、期待値がないものがあります（期待値を書くか、「どれにも合わないとき」にしてください）": {
    "en": "A line from {name} has no expected value (set one, or mark it as when nothing matches)",
    "es": "Una línea que sale de {name} no tiene valor esperado (escribe uno o márcala como cuando no coincide ninguno)",
    "fr": "Une ligne sortant de {name} n’a pas de valeur attendue (indiquez-en une, ou marquez-la comme si aucune ne correspond)",
    "zh": "{name} 引出的线中有的没有期望值（请填写期望值，或标为都不匹配）"
  },
  "{name}の期待値「{value}」が重なっています": {
    "en": "The expected value “{value}” is used more than once on {name}",
    "es": "El valor esperado «{value}» está repetido en {name}",
    "fr": "La valeur attendue « {value} » est en double sur {name}",
    "zh": "{name} 的期望值“{value}”重复了"
  },
  "{name}の「どれにも合わないとき」の線は、1本だけにしてください": {
    "en": "Keep only one “when nothing matches” line on {name}",
    "es": "Deja una sola línea «cuando no coincide ninguno» en {name}",
    "fr": "Ne gardez qu’une ligne « si aucune ne correspond » sur {name}",
    "zh": "{name} 的“都不匹配”线只能有一条"
  },
  "{name}の前は、工程にしてください（その工程のエージェントに、判定の値を書いてもらいます）": {
    "en": "The node before {name} must be a step (that step’s agent writes the result value)",
    "es": "El nodo antes de {name} debe ser un paso (su agente escribe el valor)",
    "fr": "Le nœud avant {name} doit être une étape (son agent écrit la valeur)",
    "zh": "{name} 的前面必须是步骤（由该步骤的代理写下判定值）"
  },
  "{name}からは、線を2本以上出してください": {
    "en": "Draw at least two lines from {name}",
    "es": "Traza al menos dos líneas desde {name}",
    "fr": "Sortez au moins deux lignes de {name}",
    "zh": "请从 {name} 至少拉出两条线"
  },
  "{name}から出る線は、それぞれ工程につないでください": {
    "en": "Connect each line from {name} to a step",
    "es": "Conecta cada línea que sale de {name} a un paso",
    "fr": "Reliez chaque ligne sortant de {name} à une étape",
    "zh": "请把 {name} 引出的每条线都连到步骤"
  },
  "{name}に入る線がありません": {
    "en": "No line enters {name}",
    "es": "Ninguna línea entra en {name}",
    "fr": "Aucune ligne n’entre dans {name}",
    "zh": "没有线进入 {name}"
  },
  "{name}は、開始からたどり着けません": {
    "en": "{name} cannot be reached from the start",
    "es": "No se puede llegar a {name} desde el inicio",
    "fr": "{name} est inatteignable depuis le début",
    "zh": "从开始无法到达 {name}"
  },
  "合流「{label}」に、2つの並列がつながっています": {
    "en": "Two parallels connect to the join “{label}”",
    "es": "Dos paralelos llegan a la unión «{label}»",
    "fr": "Deux parallèles arrivent à la jonction « {label} »",
    "zh": "有两个并行连到了汇合“{label}”"
  },
  "合流「{label}」には、並列「{parallel}」の枝だけをつないでください": {
    "en": "Connect only branches of the parallel “{parallel}” to the join “{label}”",
    "es": "Conecta a la unión «{label}» solo ramas del paralelo «{parallel}»",
    "fr": "Ne reliez à la jonction « {label} » que les branches du parallèle « {parallel} »",
    "zh": "汇合“{label}”只能连接并行“{parallel}”的分支"
  },
  "{name}が、どの並列の枝ともつながっていません": {
    "en": "{name} is not connected to any parallel branch",
    "es": "{name} no está conectado a ninguna rama paralela",
    "fr": "{name} n’est relié à aucune branche parallèle",
    "zh": "{name} 没有连到任何并行分支"
  },
  "{name}の判定": {
    "en": "Judgment of {name}",
    "es": "Juicio de {name}",
    "fr": "Jugement de {name}",
    "zh": "{name}的判定"
  },
  "圧縮された zip を読めません": {
    "en": "The compressed zip could not be read",
    "es": "No se pudo leer el zip comprimido",
    "fr": "Impossible de lire le zip compressé",
    "zh": "无法读取压缩后的 zip"
  },
  "zip ファイルとして読めません": {
    "en": "This is not a zip file",
    "es": "No se puede leer como archivo zip",
    "fr": "Ce n'est pas un fichier zip",
    "zh": "无法作为 zip 文件读取"
  },
  "zip の中のファイルが多すぎます（{max} まで）": {
    "en": "The zip contains too many files (up to {max})",
    "es": "El zip tiene demasiados archivos (hasta {max})",
    "fr": "Le zip contient trop de fichiers ({max} au plus)",
    "zh": "zip 里的文件太多（最多 {max} 个）"
  },
  "zip ファイルが壊れています": {
    "en": "The zip file is damaged",
    "es": "El archivo zip está dañado",
    "fr": "Le fichier zip est endommagé",
    "zh": "zip 文件已损坏"
  },
  "zip の中身が大きすぎます": {
    "en": "The contents of the zip are too large",
    "es": "El contenido del zip es demasiado grande",
    "fr": "Le contenu du zip est trop volumineux",
    "zh": "zip 的内容太大"
  },
  "この zip の圧縮方式（{method}）には対応していません": {
    "en": "This zip compression method ({method}) is not supported",
    "es": "No se admite este método de compresión del zip ({method})",
    "fr": "Cette méthode de compression zip ({method}) n'est pas prise en charge",
    "zh": "不支持此 zip 压缩方式（{method}）"
  },
  "Pipeline のファイル（.json）か、Pipeline とカスタムエージェントをまとめた zip を選んでください": {
    "en": "Choose a Pipeline file (.json), or a zip that bundles Pipelines and custom agents",
    "es": "Elige un archivo de Pipeline (.json) o un zip con Pipelines y agentes personalizados",
    "fr": "Choisissez un fichier Pipeline (.json), ou un zip regroupant Pipelines et agents personnalisés",
    "zh": "请选择 Pipeline 文件（.json），或包含 Pipeline 与自定义代理的 zip"
  },
  "取り込める Pipeline・カスタムエージェントが入っていません": {
    "en": "The file contains no Pipeline or custom agent that can be imported",
    "es": "El archivo no contiene ningún Pipeline ni agente personalizado que se pueda importar",
    "fr": "Le fichier ne contient aucun Pipeline ni agent personnalisé importable",
    "zh": "文件中没有可导入的 Pipeline 或自定义代理"
  },
  "カスタムエージェントは {max} 個までです。いらないものを消してから取り込んでください": {
    "en": "You can have at most {max} custom agents. Delete some before importing",
    "es": "Puedes tener como máximo {max} agentes personalizados. Borra algunos antes de importar",
    "fr": "Vous pouvez avoir au plus {max} agents personnalisés. Supprimez-en avant d'importer",
    "zh": "自定义代理最多 {max} 个。请先删除不需要的再导入"
  },
  "Pipeline は {max} 個までです。いらないものを消してから取り込んでください": {
    "en": "You can have at most {max} Pipelines. Delete some before importing",
    "es": "Puedes tener como máximo {max} Pipelines. Borra algunos antes de importar",
    "fr": "Vous pouvez avoir au plus {max} Pipelines. Supprimez-en avant d'importer",
    "zh": "Pipeline 最多 {max} 个。请先删除不需要的再导入"
  },
  "{pipeline}「{step}」": {
    "en": "{pipeline} “{step}”",
    "es": "{pipeline} «{step}»",
    "fr": "{pipeline} « {step} »",
    "zh": "{pipeline}“{step}”"
  },
  "{agent} は CLI の作りの都合で、カードでの承認・選択肢の質問・作業途中へのメッセージ差し込み・既存の会話の引き継ぎに対応していません（btw は終了後の追加指示として送られます）。権限は設定の権限モードに合わせて CLI 側で許可します。": {
    "en": "Because of how the {agent} CLI works, it does not support approval on the card, multiple-choice questions, inserting a message mid-task, or continuing an existing conversation (btw is sent as a follow-up instruction after it finishes). Permissions are granted by the CLI according to the permission mode in settings.",
    "es": "Por cómo está hecho el CLI de {agent}, no admite la aprobación en la tarjeta, preguntas de opción, insertar un mensaje a mitad del trabajo ni continuar una conversación existente (btw se envía como instrucción adicional al terminar). Los permisos los concede el CLI según el modo de permisos de los ajustes.",
    "fr": "À cause du fonctionnement du CLI {agent}, l'approbation sur la carte, les questions à choix, l'insertion d'un message en cours de tâche et la reprise d'une conversation existante ne sont pas prises en charge (btw est envoyé comme instruction supplémentaire à la fin). Les permissions sont accordées par le CLI selon le mode des réglages.",
    "zh": "由于 {agent} CLI 的实现方式，不支持在卡片上批准、选择题、在工作中途插入消息，以及继续已有对话（btw 会在结束后作为追加指示发送）。权限由 CLI 按设置中的权限模式授予。"
  },
  "フローチャートがありません": {
    "en": "There is no flowchart",
    "es": "No hay diagrama",
    "fr": "Il n'y a pas d'organigramme",
    "zh": "没有流程图"
  },
  "分岐{n}": {
    "en": "branch {n}",
    "es": "bifurcación {n}",
    "fr": "branchement {n}",
    "zh": "分支 {n}"
  },
  "並列{n}": {
    "en": "parallel {n}",
    "es": "paralelo {n}",
    "fr": "parallèle {n}",
    "zh": "并行 {n}"
  },
  "ループ{n}": {
    "en": "loop {n}",
    "es": "bucle {n}",
    "fr": "boucle {n}",
    "zh": "循环 {n}"
  },
  "・": {
    "en": ", ",
    "es": ", ",
    "fr": ", ",
    "zh": "、"
  },
  "未設定": {
    "en": "not set",
    "es": "sin configurar",
    "fr": "non défini",
    "zh": "未设置"
  },
  "（{extra}）": {
    "en": " ({extra})",
    "es": " ({extra})",
    "fr": " ({extra})",
    "zh": "（{extra}）"
  },
  "（カスタムエージェントが見つかりません）": {
    "en": " (custom agent not found)",
    "es": " (agente personalizado no encontrado)",
    "fr": " (agent personnalisé introuvable)",
    "zh": "（找不到自定义代理）"
  },
  "分岐（if） {n}": {
    "en": "branch (if) {n}",
    "es": "bifurcación (if) {n}",
    "fr": "branchement (if) {n}",
    "zh": "分支（if） {n}"
  },
  "並列 {n}": {
    "en": "parallel {n}",
    "es": "paralelo {n}",
    "fr": "parallèle {n}",
    "zh": "并行 {n}"
  },
  "ループ {n}": {
    "en": "loop {n}",
    "es": "bucle {n}",
    "fr": "boucle {n}",
    "zh": "循环 {n}"
  },
  " ・ ": {
    "en": " · ",
    "es": " · ",
    "fr": " · ",
    "zh": "、"
  },
  "工程がありません": {
    "en": "There are no steps",
    "es": "No hay pasos",
    "fr": "Il n'y a pas d'étapes",
    "zh": "没有步骤"
  },
  "直すところがあります: {error}": {
    "en": "Something needs fixing: {error}",
    "es": "Hay algo que corregir: {error}",
    "fr": "Quelque chose est à corriger : {error}",
    "zh": "有需要修改的地方：{error}"
  },
  " ほか {n} 件": {
    "en": " ({n} more)",
    "es": " ({n} más)",
    "fr": " ({n} de plus)",
    "zh": "（另有 {n} 项）"
  },
  "1つのエージェントで動かす": {
    "en": "Run with one agent",
    "es": "Ejecutar con un agente",
    "fr": "Exécuter avec un agent",
    "zh": "用一个代理运行"
  },
  "{name}{mark}": {
    "en": "{name}{mark}",
    "es": "{name}{mark}",
    "fr": "{name}{mark}",
    "zh": "{name}{mark}"
  },
  "（要修正）": {
    "en": " (needs fixing)",
    "es": " (hay que corregir)",
    "fr": " (à corriger)",
    "zh": "（需要修改）"
  },
  "（使えません）": {
    "en": " (unavailable)",
    "es": " (no disponible)",
    "fr": " (indisponible)",
    "zh": "（不可用）"
  },
  "{name}: {flow}{why}": {
    "en": "{name}: {flow}{why}",
    "es": "{name}: {flow}{why}",
    "fr": "{name} : {flow}{why}",
    "zh": "{name}：{flow}{why}"
  },
  "（設定のフローチャートを直してください）": {
    "en": " (fix the flowchart in settings)",
    "es": " (corrige el diagrama en los ajustes)",
    "fr": " (corrigez l'organigramme dans les réglages)",
    "zh": "（请在设置中修改流程图）"
  },
  "（設定で工程のエージェントを使う設定にしてください）": {
    "en": " (enable the step's agent in settings)",
    "es": " (activa el agente del paso en los ajustes)",
    "fr": " (activez l'agent de l'étape dans les réglages)",
    "zh": "（请在设置中启用该步骤的代理）"
  },
  "オーケストレーション": {
    "en": "Orchestration",
    "es": "Orquestación",
    "fr": "Orchestration",
    "zh": "编排"
  },
  "競争: {names} で同じタスクを解いて比べる": {
    "en": "Compete: {names} solve the same task and are compared",
    "es": "Competencia: {names} resuelven la misma tarea y se comparan",
    "fr": "Concours : {names} résolvent la même tâche et sont comparés",
    "zh": "竞争：让 {names} 解决同一任务并比较"
  },
  "競争（設定で使うエージェントを2つ以上選んでください）": {
    "en": "Compete (choose at least two agents in settings)",
    "es": "Competencia (elige al menos dos agentes en los ajustes)",
    "fr": "Concours (choisissez au moins deux agents dans les réglages)",
    "zh": "竞争（请在设置中至少选择两个代理）"
  },
  "選んだ Pipeline が見つかりません。選び直してください。": {
    "en": "The selected Pipeline was not found. Choose another.",
    "es": "No se encuentra el Pipeline elegido. Elige otro.",
    "fr": "Le Pipeline choisi est introuvable. Choisissez-en un autre.",
    "zh": "找不到所选的 Pipeline。请重新选择。"
  },
  "Pipeline「{name}」: {flow}{why}。": {
    "en": "Pipeline “{name}”: {flow}{why}.",
    "es": "Pipeline «{name}»: {flow}{why}.",
    "fr": "Pipeline « {name} » : {flow}{why}.",
    "zh": "Pipeline“{name}”：{flow}{why}。"
  },
  "設定のフローチャートに沿って、工程ごとにエージェントが作業を引き継ぎます（前の工程の報告を次に渡します。分岐・ループ・並列もフローのとおりに動きます）。フローチャートは「設定」で変えられます。": {
    "en": "Agents hand the work from step to step along the flowchart in settings (each step receives the previous report. Branches, loops, and parallels follow the flow). You can change the flowchart in Settings.",
    "es": "Los agentes se pasan el trabajo paso a paso según el diagrama de los ajustes (cada paso recibe el informe anterior. Bifurcaciones, bucles y paralelos siguen el flujo). Puedes cambiar el diagrama en Ajustes.",
    "fr": "Les agents se transmettent le travail d'étape en étape selon l'organigramme des réglages (chaque étape reçoit le rapport précédent. Branchements, boucles et parallèles suivent le flux). Vous pouvez changer l'organigramme dans Réglages.",
    "zh": "代理按设置中的流程图逐步交接工作（下一步会收到上一步的报告。分支、循环和并行也按流程运行）。流程图可在“设置”中修改。"
  },
  "エージェントごとにカードと worktree を作って並列に解きます。終わったら差分を見比べ、よい案を採用してマージします。": {
    "en": "Each agent gets its own card and worktree and solves the task in parallel. When they finish, compare the diffs, pick the better result, and merge it.",
    "es": "Cada agente tiene su tarjeta y su worktree y resuelve la tarea en paralelo. Al terminar, compara las diferencias, elige la mejor propuesta y fusiónala.",
    "fr": "Chaque agent a sa carte et son worktree et résout la tâche en parallèle. À la fin, comparez les différences, retenez la meilleure proposition et fusionnez-la.",
    "zh": "每个代理各自有卡片和 worktree，并行解决问题。结束后比较差异，采用较好的方案并合并。"
  },
  "カスタムエージェントが見つかりません。選び直してください。": {
    "en": "The custom agent was not found. Choose another.",
    "es": "No se encuentra el agente personalizado. Elige otro.",
    "fr": "L'agent personnalisé est introuvable. Choisissez-en un autre.",
    "zh": "找不到自定义代理。请重新选择。"
  },
  "{agent} を「{name}」のプロフィールで動かします（モデル: {model}）。": {
    "en": "{agent} runs with the “{name}” profile (model: {model}).",
    "es": "{agent} se ejecuta con el perfil «{name}» (modelo: {model}).",
    "fr": "{agent} s'exécute avec le profil « {name} » (modèle : {model}).",
    "zh": "以“{name}”的设定运行 {agent}（模型：{model}）。"
  },
  "CLI の既定": {
    "en": "CLI default",
    "es": "predeterminado del CLI",
    "fr": "valeur par défaut du CLI",
    "zh": "CLI 默认值"
  },
  "例: {model}（設定の既定）": {
    "en": "e.g. {model} (the default in settings)",
    "es": "p. ej. {model} (el predeterminado de los ajustes)",
    "fr": "p. ex. {model} (la valeur par défaut des réglages)",
    "zh": "例：{model}（设置中的默认值）"
  },
  "{agent} に渡すモデルです。空なら{fallback}を使います。": {
    "en": "This is the model passed to {agent}. If blank, {fallback} is used.",
    "es": "Este es el modelo que se pasa a {agent}. Si está vacío, se usa {fallback}.",
    "fr": "C'est le modèle transmis à {agent}. S'il est vide, {fallback} est utilisé.",
    "zh": "这是传给 {agent} 的模型。留空则使用{fallback}。"
  },
  "設定の「{model}」": {
    "en": "“{model}” from settings",
    "es": "«{model}» de los ajustes",
    "fr": "« {model} » des réglages",
    "zh": "设置中的“{model}”"
  },
  " CLI の既定のモデル": {
    "en": "the CLI default model",
    "es": "el modelo predeterminado del CLI",
    "fr": "le modèle par défaut du CLI",
    "zh": "CLI 的默认模型"
  },
  "修正タスク": {
    "en": "Fix task",
    "es": "Tarea de corrección",
    "fr": "Tâche de correction",
    "zh": "修改任务"
  },
  "新しいタスク": {
    "en": "New task",
    "es": "Nueva tarea",
    "fr": "Nouvelle tâche",
    "zh": "新任务"
  },
  "完了したタスク「{title}」の修正として、新しいタスクを始めます（元のタスクのやりとりをエージェントが引き継ぎます。元のタスクはそのまま残ります）。": {
    "en": "Start a new task to fix the completed task “{title}” (the agent continues that conversation. The original task stays as it is).",
    "es": "Empieza una tarea nueva para corregir la tarea completada «{title}» (el agente continúa esa conversación. La tarea original se queda igual).",
    "fr": "Commence une nouvelle tâche pour corriger la tâche terminée « {title} » (l'agent reprend cette conversation. La tâche d'origine reste telle quelle).",
    "zh": "作为已完成任务“{title}”的修改，开始一个新任务（代理会接上原来的对话。原任务保持不变）。"
  },
  "会話「{title}」の続きとして、タスクを始めます（会話の内容をエージェントが引き継ぎます。会話そのものはそのまま残ります）。": {
    "en": "Start a task as a continuation of the conversation “{title}” (the agent keeps that conversation. The conversation itself stays as it is).",
    "es": "Empieza una tarea como continuación de la conversación «{title}» (el agente conserva esa conversación. La conversación se queda igual).",
    "fr": "Commence une tâche dans la suite de la conversation « {title} » (l'agent reprend cette conversation. La conversation elle-même reste telle quelle).",
    "zh": "作为对话“{title}”的后续开始任务（代理会接上对话内容。对话本身保持不变）。"
  },
  "タイトル（省略すると指示の1行目）": {
    "en": "Title (the first line of the instructions if left blank)",
    "es": "Título (si se omite, la primera línea de las instrucciones)",
    "fr": "Titre (la première ligne des instructions s'il est vide)",
    "zh": "标题（留空则用指示的第一行）"
  },
  "例: ログイン画面にパスワード表示ボタンを追加": {
    "en": "e.g. Add a show-password button to the login screen",
    "es": "p. ej. Añadir un botón para mostrar la contraseña en la pantalla de inicio",
    "fr": "p. ex. Ajouter un bouton pour afficher le mot de passe sur l'écran de connexion",
    "zh": "例：在登录画面添加显示密码的按钮"
  },
  "エージェントへの指示": {
    "en": "Instructions for the agent",
    "es": "Instrucciones para el agente",
    "fr": "Instructions pour l'agent",
    "zh": "给代理的指示"
  },
  "やってほしいことを具体的に書いてください。テストの実行方法なども書いておくと確実です。画像やファイルは貼り付け・ドラッグ＆ドロップでも添付できます。": {
    "en": "Describe what you want in detail. Including how to run the tests makes it more reliable. You can also attach images and files by pasting or dragging them.",
    "es": "Describe con detalle lo que quieres. Indicar cómo ejecutar las pruebas lo hace más seguro. También puedes adjuntar imágenes y archivos pegándolos o arrastrándolos.",
    "fr": "Décrivez précisément ce que vous voulez. Indiquer comment lancer les tests le rend plus fiable. Vous pouvez aussi joindre des images et des fichiers en les collant ou en les déposant.",
    "zh": "请具体写下希望完成的事。写上测试的运行方法会更稳妥。也可以通过粘贴或拖放附加图片和文件。"
  },
  "SQL を作るだけ・調べるだけなど、ソースコードを変えないタスクにします。worktree とブランチは作らず、リポジトリのフォルダでファイルを書き換えるツールを止めて動かします。作ったものはチャットの返事に出るので、確かめてから「完了にする」を押します": {
    "en": "Make this a task that does not change source code, such as writing SQL or looking something up. No worktree or branch is created, and tools that edit files in the repository are blocked. The result appears in the chat, so check it and then press Mark complete",
    "es": "Haz que sea una tarea que no cambia el código, como crear SQL o investigar. No se crea worktree ni rama, y se bloquean las herramientas que reescriben archivos en el repositorio. El resultado sale en el chat: revísalo y pulsa Marcar como completada",
    "fr": "Faites-en une tâche qui ne modifie pas le code, comme écrire du SQL ou chercher une information. Aucun worktree ni branche n'est créé, et les outils qui réécrivent les fichiers du dépôt sont bloqués. Le résultat apparaît dans le chat : vérifiez-le puis appuyez sur Marquer comme terminé",
    "zh": "设为不修改源代码的任务，例如只生成 SQL 或只做调查。不创建 worktree 和分支，并禁止在仓库文件夹中改写文件的工具。结果会出现在聊天回复里，确认后再按“标为完成”"
  },
  "ソースを変更しない（調べもの・SQL などの生成だけ）": {
    "en": "Do not change source (lookup or generating SQL only)",
    "es": "No cambiar el código (solo investigar o generar SQL)",
    "fr": "Ne pas modifier le code (recherche ou génération de SQL seulement)",
    "zh": "不修改源代码（仅调查或生成 SQL 等）"
  },
  "作成（Ctrl/⌘ + Enter）": {
    "en": "Create (Ctrl/⌘ + Enter)",
    "es": "Crear (Ctrl/⌘ + Enter)",
    "fr": "Créer (Ctrl/⌘ + Entrée)",
    "zh": "创建（Ctrl/⌘ + Enter）"
  },
  "完了したタスクの内容をもとに、次の点を修正してください。": {
    "en": "Using the completed task, fix the following.",
    "es": "A partir de la tarea completada, corrige lo siguiente.",
    "fr": "À partir de la tâche terminée, corrigez les points suivants.",
    "zh": "请根据已完成任务的内容，修改以下几点。"
  },
  "ここまでの会話の内容をもとに、作業を進めてください。": {
    "en": "Continue the work from the conversation so far.",
    "es": "Continúa el trabajo a partir de la conversación hasta ahora.",
    "fr": "Poursuivez le travail à partir de la conversation jusqu'ici.",
    "zh": "请根据到目前为止的对话继续工作。"
  },
  "修正: {title}": {
    "en": "Fix: {title}",
    "es": "Corrección: {title}",
    "fr": "Correction : {title}",
    "zh": "修改：{title}"
  },
  "会話: {title}": {
    "en": "Conversation: {title}",
    "es": "Conversación: {title}",
    "fr": "Conversation : {title}",
    "zh": "对话：{title}"
  },
  "タスクを作成しています…": {
    "en": "Creating the task…",
    "es": "Creando la tarea…",
    "fr": "Création de la tâche…",
    "zh": "正在创建任务…"
  },
  "自然言語で作成": {
    "en": "Create in plain language",
    "es": "Crear en lenguaje natural",
    "fr": "Créer en langage naturel",
    "zh": "用自然语言创建"
  },
  "{label} Issue から作成": {
    "en": "Create from a {label} Issue",
    "es": "Crear desde un Issue de {label}",
    "fr": "Créer depuis un Issue {label}",
    "zh": "从 {label} Issue 创建"
  },
  "タスクを作らずに、このリポジトリについてエージェントと話した会話です。選ぶと開きます。": {
    "en": "Conversations about this repository with an agent, without creating a task. Choose one to open it.",
    "es": "Conversaciones con un agente sobre este repositorio, sin crear una tarea. Elige una para abrirla.",
    "fr": "Conversations avec un agent à propos de ce dépôt, sans créer de tâche. Choisissez-en une pour l'ouvrir.",
    "zh": "这是不创建任务、与代理谈论此仓库的对话。选择后即可打开。"
  },
  "会話はまだありません": {
    "en": "No conversations yet",
    "es": "Aún no hay conversaciones",
    "fr": "Pas encore de conversation",
    "zh": "还没有对话"
  },
  "閉じる": {
    "en": "Close",
    "es": "Cerrar",
    "fr": "Fermer",
    "zh": "关闭"
  },
  "＋ 新しい会話": {
    "en": "+ New conversation",
    "es": "+ Nueva conversación",
    "fr": "+ Nouvelle conversation",
    "zh": "＋ 新对话"
  },
  "タスクを作らずに、このリポジトリについてエージェントと話せます（質問・調べもの・相談など）。worktree やブランチは作らず、コミットやマージもしません。": {
    "en": "Talk with an agent about this repository without creating a task (questions, lookups, advice). No worktree or branch is created, and nothing is committed or merged.",
    "es": "Puedes hablar con un agente sobre este repositorio sin crear una tarea (preguntas, búsquedas, consultas). No se crea worktree ni rama, ni se hace commit o merge.",
    "fr": "Vous pouvez parler avec un agent de ce dépôt sans créer de tâche (questions, recherches, conseils). Aucun worktree ni branche n'est créé, et rien n'est commité ni fusionné.",
    "zh": "可以不创建任务，与代理谈论此仓库（提问、调查、商量等）。不创建 worktree 或分支，也不会提交或合并。"
  },
  "メッセージ": {
    "en": "Message",
    "es": "Mensaje",
    "fr": "Message",
    "zh": "消息"
  },
  "タイトル（省略するとメッセージの1行目）": {
    "en": "Title (the first line of the message if left blank)",
    "es": "Título (si se omite, la primera línea del mensaje)",
    "fr": "Titre (la première ligne du message s'il est vide)",
    "zh": "标题（留空则用消息的第一行）"
  },
  "会話はリポジトリのフォルダ（手元の作業中のファイル）でそのまま動くので、ファイルの変更やコマンドは毎回カードで確かめます。作業してほしくなったら、詳細画面の「タスクにする」で会話の続きからタスクを作れます。": {
    "en": "The conversation runs directly in the repository folder (your working files), so file changes and commands are confirmed on the card each time. When you want the agent to do the work, use Turn into a task on the detail screen to continue from this conversation.",
    "es": "La conversación se ejecuta directamente en la carpeta del repositorio (los archivos en los que trabajas), así que cada cambio de archivo o comando se confirma en la tarjeta. Cuando quieras que trabaje, usa Convertir en tarea en la pantalla de detalle para continuar desde esta conversación.",
    "fr": "La conversation s'exécute directement dans le dossier du dépôt (vos fichiers en cours), donc chaque modification de fichier ou commande est confirmée sur la carte. Quand vous voulez qu'il travaille, utilisez Transformer en tâche dans l'écran de détail pour continuer depuis cette conversation.",
    "zh": "对话直接在仓库文件夹（你正在编辑的文件）中运行，因此每次改文件或执行命令都会在卡片上确认。若希望开始工作，可在详情页用“转为任务”，从这段对话继续创建任务。"
  },
  "話しかける（Ctrl/⌘ + Enter）": {
    "en": "Send (Ctrl/⌘ + Enter)",
    "es": "Hablar (Ctrl/⌘ + Enter)",
    "fr": "Envoyer (Ctrl/⌘ + Entrée)",
    "zh": "发送（Ctrl/⌘ + Enter）"
  },
  "会話を始めています…": {
    "en": "Starting the conversation…",
    "es": "Iniciando la conversación…",
    "fr": "Démarrage de la conversation…",
    "zh": "正在开始对话…"
  },
  "プロジェクト": {
    "en": "Project",
    "es": "Proyecto",
    "fr": "Projet",
    "zh": "项目"
  },
  "自分用": {
    "en": "Personal",
    "es": "Personal",
    "fr": "Personnel",
    "zh": "个人"
  },
  "プラグイン": {
    "en": "Plugin",
    "es": "Complemento",
    "fr": "Extension",
    "zh": "插件"
  },
  "変更": {
    "en": "Change",
    "es": "Cambiar",
    "fr": "Changer",
    "zh": "更改"
  },
  "スキルを読み込んでいます…": {
    "en": "Loading skills…",
    "es": "Cargando habilidades…",
    "fr": "Chargement des skills…",
    "zh": "正在加载技能…"
  },
  "（説明なし）": {
    "en": "(no description)",
    "es": "(sin descripción)",
    "fr": "(sans description)",
    "zh": "（无说明）"
  },
  "スキルなし": {
    "en": "No skill",
    "es": "Sin skill",
    "fr": "Aucun skill",
    "zh": "不使用技能"
  },
  "スキルを使わずに、指示だけで実行します": {
    "en": "Run from the instructions only, without a skill",
    "es": "Ejecutar solo con las instrucciones, sin skill",
    "fr": "Exécuter avec les instructions seules, sans skill",
    "zh": "不使用技能，只按指示执行"
  },
  "見つかりません": {
    "en": "Nothing found",
    "es": "No se encuentra",
    "fr": "Introuvable",
    "zh": "找不到"
  },
  "スキルを選ぶ": {
    "en": "Choose a skill",
    "es": "Elegir un skill",
    "fr": "Choisir un skill",
    "zh": "选择技能"
  },
  "1つだけ選べます。選んだスキルは、Claude Code には指示の先頭に ": {
    "en": "You can choose only one. For Claude Code, the chosen skill is added at the start of the instructions as ",
    "es": "Solo puedes elegir uno. Para Claude Code, el skill elegido se añade al principio de las instrucciones como ",
    "fr": "Vous ne pouvez en choisir qu'un. Pour Claude Code, le skill choisi est ajouté au début des instructions comme ",
    "zh": "只能选一个。所选技能会以 "
  },
  "/スキル名": {
    "en": "/skill-name",
    "es": "/nombre-del-skill",
    "fr": "/nom-du-skill",
    "zh": "/技能名"
  },
  " として、ほかのエージェントには SKILL.md の場所を添えて渡します。": {
    "en": " and, for other agents, the path to SKILL.md is included.",
    "es": " y, para los demás agentes, se adjunta la ruta de SKILL.md.",
    "fr": " et, pour les autres agents, le chemin de SKILL.md est joint.",
    "zh": " 的形式放在 Claude Code 指示的开头；其他代理则会附上 SKILL.md 的位置。"
  },
  "使えるスキルが見つかりません。<code>.claude/skills/&lt;名前&gt;/SKILL.md</code>（このリポジトリ）か <code>~/.claude/skills/</code> に置くと、ここに出ます。": {
    "en": "No usable skills were found. Put one at <code>.claude/skills/&lt;name&gt;/SKILL.md</code> (this repository) or <code>~/.claude/skills/</code> and it will appear here.",
    "es": "No se encontraron skills utilizables. Coloca uno en <code>.claude/skills/&lt;nombre&gt;/SKILL.md</code> (este repositorio) o en <code>~/.claude/skills/</code> y aparecerá aquí.",
    "fr": "Aucun skill utilisable n'a été trouvé. Placez-en un dans <code>.claude/skills/&lt;nom&gt;/SKILL.md</code> (ce dépôt) ou <code>~/.claude/skills/</code> et il apparaîtra ici.",
    "zh": "找不到可用的技能。放到 <code>.claude/skills/&lt;名称&gt;/SKILL.md</code>（此仓库）或 <code>~/.claude/skills/</code> 后，就会出现在这里。"
  },
  "会話（セッション）": {
    "en": "Conversation (session)",
    "es": "Conversación (sesión)",
    "fr": "Conversation (session)",
    "zh": "对话（会话）"
  },
  "新しい会話で始める": {
    "en": "Start a new conversation",
    "es": "Empezar una conversación nueva",
    "fr": "Commencer une nouvelle conversation",
    "zh": "用新对话开始"
  },
  "過去の会話を読み込んでいます…": {
    "en": "Loading past conversations…",
    "es": "Cargando conversaciones anteriores…",
    "fr": "Chargement des conversations passées…",
    "zh": "正在加载过去的对话…"
  },
  "過去の Claude Code の会話を選ぶと、その続きとして始めます（元の会話はそのまま残ります）。": {
    "en": "Choose a past Claude Code conversation to continue from it (the original conversation stays as it is).",
    "es": "Elige una conversación anterior de Claude Code para continuar desde ella (la conversación original se queda igual).",
    "fr": "Choisissez une conversation Claude Code passée pour la continuer (la conversation d'origine reste telle quelle).",
    "zh": "选择过去的 Claude Code 对话后，会从那段对话继续（原对话保持不变）。"
  },
  "このリポジトリの会話": {
    "en": "Conversations in this repository",
    "es": "Conversaciones de este repositorio",
    "fr": "Conversations de ce dépôt",
    "zh": "此仓库的对话"
  },
  "（このリポジトリの過去の会話はありません）": {
    "en": "(no past conversations in this repository)",
    "es": "(no hay conversaciones anteriores en este repositorio)",
    "fr": "(aucune conversation passée dans ce dépôt)",
    "zh": "（此仓库没有过去的对话）"
  },
  "既存の会話を引き継ぐ": {
    "en": "Continue an existing conversation",
    "es": "Continuar una conversación existente",
    "fr": "Reprendre une conversation existante",
    "zh": "接上已有对话"
  },
  "この会話を使う": {
    "en": "Use this conversation",
    "es": "Usar esta conversación",
    "fr": "Utiliser cette conversation",
    "zh": "使用此对话"
  },
  "次は新しい会話で始めます": {
    "en": "The next run starts a new conversation",
    "es": "La próxima vez empieza una conversación nueva",
    "fr": "La prochaine fois commence une nouvelle conversation",
    "zh": "下次用新对话开始"
  },
  "次はこの会話の続きで始めます": {
    "en": "The next run continues this conversation",
    "es": "La próxima vez continúa esta conversación",
    "fr": "La prochaine fois continue cette conversation",
    "zh": "下次从此对话继续"
  },
  "既存の会話から選ぶ…": {
    "en": "Choose from existing conversations…",
    "es": "Elegir de las conversaciones existentes…",
    "fr": "Choisir parmi les conversations existantes…",
    "zh": "从已有对话中选择…"
  },
  "会話": {
    "en": "Conversation",
    "es": "Conversación",
    "fr": "Conversation",
    "zh": "对话"
  },
  "実行中は切り替えられません": {
    "en": "You cannot switch while it is running",
    "es": "No se puede cambiar mientras se ejecuta",
    "fr": "Impossible de changer pendant l'exécution",
    "zh": "运行中无法切换"
  },
  "会話（セッション）を消す": {
    "en": "Delete conversations (sessions)",
    "es": "Eliminar conversaciones (sesiones)",
    "fr": "Supprimer des conversations (sessions)",
    "zh": "删除对话（会话）"
  },
  "Claude Code の会話の記録（~/.claude/projects の中）を消します。消した会話は元に戻せず、続きから再開することもできません。実行中・待機中のタスクが使っている会話は消せません。": {
    "en": "This deletes Claude Code conversation records (under ~/.claude/projects). Deleted conversations cannot be restored or resumed. Conversations used by a running or waiting task cannot be deleted.",
    "es": "Esto borra los registros de conversaciones de Claude Code (en ~/.claude/projects). Las conversaciones borradas no se pueden restaurar ni reanudar. No se pueden borrar las que usa una tarea en ejecución o en espera.",
    "fr": "Cela supprime les enregistrements de conversations Claude Code (dans ~/.claude/projects). Une conversation supprimée ne peut ni être restaurée ni reprise. Celles utilisées par une tâche en cours ou en attente ne peuvent pas être supprimées.",
    "zh": "这将删除 Claude Code 的对话记录（~/.claude/projects 中）。删除后无法恢复，也不能接着继续。正在运行或等待中的任务所使用的对话不能删除。"
  },
  " 表示中をすべて選ぶ": {
    "en": " Select all shown",
    "es": " Seleccionar todo lo visible",
    "fr": " Tout sélectionner à l'écran",
    "zh": " 全选当前显示的"
  },
  "会話を読み込んでいます…": {
    "en": "Loading conversations…",
    "es": "Cargando conversaciones…",
    "fr": "Chargement des conversations…",
    "zh": "正在加载对话…"
  },
  "選んだ会話を消す": {
    "en": "Delete selected conversations",
    "es": "Eliminar las conversaciones elegidas",
    "fr": "Supprimer les conversations choisies",
    "zh": "删除所选对话"
  },
  "（消せる会話はありません）": {
    "en": "(no conversations can be deleted)",
    "es": "(no hay conversaciones que se puedan eliminar)",
    "fr": "(aucune conversation ne peut être supprimée)",
    "zh": "（没有可删除的对话）"
  },
  "実行中のタスクで使用中": {
    "en": "In use by a running task",
    "es": "En uso por una tarea en ejecución",
    "fr": "Utilisée par une tâche en cours",
    "zh": "正在被运行中的任务使用"
  },
  "会話を消しています…": {
    "en": "Deleting conversations…",
    "es": "Eliminando conversaciones…",
    "fr": "Suppression des conversations…",
    "zh": "正在删除对话…"
  },
  "Issue を読み込んでタスクを作成しています…": {
    "en": "Loading the Issue and creating the task…",
    "es": "Cargando el Issue y creando la tarea…",
    "fr": "Chargement de l'Issue et création de la tâche…",
    "zh": "正在读取 Issue 并创建任务…"
  },
  "Issue 番号（複数ならカンマかスペースで区切る。1つの Issue が1枚のカードになり、並列で動きます）": {
    "en": "Issue numbers (separate several with a comma or a space. Each Issue becomes one card and they run in parallel)",
    "es": "Números de Issue (separa varios con coma o espacio. Cada Issue es una tarjeta y se ejecutan en paralelo)",
    "fr": "Numéros d'Issue (séparez-en plusieurs par une virgule ou un espace. Chaque Issue devient une carte et elles tournent en parallèle)",
    "zh": "Issue 编号（多个时用逗号或空格分隔。一个 Issue 一张卡片，并行运行）"
  },
  "リポジトリを確認しています…": {
    "en": "Checking the repository…",
    "es": "Comprobando el repositorio…",
    "fr": "Vérification du dépôt…",
    "zh": "正在确认仓库…"
  },
  "gh（GitHub CLI）を確認しています…": {
    "en": "Checking gh (GitHub CLI)…",
    "es": "Comprobando gh (GitHub CLI)…",
    "fr": "Vérification de gh (GitHub CLI)…",
    "zh": "正在确认 gh（GitHub CLI）…"
  },
  "追加の指示（任意・すべての Issue に付けます）": {
    "en": "Extra instructions (optional, added to every Issue)",
    "es": "Instrucciones adicionales (opcional, se añaden a todos los Issues)",
    "fr": "Instructions supplémentaires (facultatif, ajoutées à chaque Issue)",
    "zh": "追加指示（可选，会加到所有 Issue）"
  },
  " 作成したらすぐに開始する": {
    "en": " Start as soon as it is created",
    "es": " Empezar en cuanto se cree",
    "fr": " Démarrer dès la création",
    "zh": " 创建后立即开始"
  },
  "Issue からタスクを作成": {
    "en": "Create tasks from Issues",
    "es": "Crear tareas desde Issues",
    "fr": "Créer des tâches depuis des Issues",
    "zh": "从 Issue 创建任务"
  },
  "このリポジトリの origin が GitHub ではないため、Issue を読み込めません。": {
    "en": "Issues cannot be loaded because this repository's origin is not GitHub.",
    "es": "No se pueden cargar Issues porque el origin de este repositorio no es GitHub.",
    "fr": "Les Issues ne peuvent pas être chargés car l'origin de ce dépôt n'est pas GitHub.",
    "zh": "此仓库的 origin 不是 GitHub，因此无法读取 Issue。"
  },
  "Issue を読み込んでいます…": {
    "en": "Loading Issues…",
    "es": "Cargando Issues…",
    "fr": "Chargement des Issues…",
    "zh": "正在读取 Issue…"
  },
  "（ベース）": {
    "en": " (base)",
    "es": " (base)",
    "fr": " (base)",
    "zh": "（基准）"
  },
  "（チェックアウト中）": {
    "en": " (checked out)",
    "es": " (en checkout)",
    "fr": " (extrait)",
    "zh": "（已检出）"
  },
  "マージ": {
    "en": "Merge",
    "es": "Fusionar",
    "fr": "Fusionner",
    "zh": "合并"
  },
  " を、選んだブランチにマージします（--no-ff）。": {
    "en": " will be merged into the branch you choose (--no-ff).",
    "es": " se fusionará en la rama que elijas (--no-ff).",
    "fr": " sera fusionnée dans la branche choisie (--no-ff).",
    "zh": " 将合并到所选分支（--no-ff）。"
  },
  "マージ先のブランチ": {
    "en": "Branch to merge into",
    "es": "Rama de destino",
    "fr": "Branche de destination",
    "zh": "合并目标分支"
  },
  "＋ 新しいブランチを作ってマージ…": {
    "en": "+ Create a new branch and merge…",
    "es": "+ Crear una rama nueva y fusionar…",
    "fr": "+ Créer une nouvelle branche et fusionner…",
    "zh": "＋ 新建分支并合并…"
  },
  " マージしたあと origin に push する（": {
    "en": " After merging, push to origin (",
    "es": " Después de fusionar, hacer push a origin (",
    "fr": " Après la fusion, pousser vers origin (",
    "zh": " 合并后 push 到 origin（"
  },
  " にも反映）": {
    "en": " is updated too)",
    "es": " también se actualiza)",
    "fr": " est aussi mis à jour)",
    "zh": " 也会更新）"
  },
  "このリポジトリには origin がないので、ローカルのブランチにだけマージします。": {
    "en": "This repository has no origin, so the merge stays on the local branch.",
    "es": "Este repositorio no tiene origin, así que solo se fusiona en la rama local.",
    "fr": "Ce dépôt n'a pas d'origin, donc la fusion reste sur la branche locale.",
    "zh": "此仓库没有 origin，因此只合并到本地分支。"
  },
  " マージ後もタスクを続ける（worktree とブランチを残す）": {
    "en": " Keep working on the task after the merge (keep the worktree and branch)",
    "es": " Seguir con la tarea después de fusionar (conservar el worktree y la rama)",
    "fr": " Continuer la tâche après la fusion (garder le worktree et la branche)",
    "zh": " 合并后继续此任务（保留 worktree 和分支）"
  },
  "（新しいブランチ）": {
    "en": "(new branch)",
    "es": "(rama nueva)",
    "fr": "(nouvelle branche)",
    "zh": "（新分支）"
  },
  "マージしたあとも、このタスクはレビュー列に残ります。": {
    "en": "After the merge, this task stays in the review column.",
    "es": "Después de fusionar, esta tarea sigue en la columna de revisión.",
    "fr": "Après la fusion, cette tâche reste dans la colonne de revue.",
    "zh": "合并之后，此任务仍留在评审列。"
  },
  "ブランチ名を入力してください": {
    "en": "Enter a branch name",
    "es": "Introduce un nombre de rama",
    "fr": "Saisissez un nom de branche",
    "zh": "请输入分支名"
  },
  "マージして push しています…": {
    "en": "Merging and pushing…",
    "es": "Fusionando y haciendo push…",
    "fr": "Fusion et push…",
    "zh": "正在合并并 push…"
  },
  "マージしています…": {
    "en": "Merging…",
    "es": "Fusionando…",
    "fr": "Fusion…",
    "zh": "正在合并…"
  },
  "---\nWorktree Kanban のタスクから作成しました。": {
    "en": "---\nCreated from an Worktree Kanban task.",
    "es": "---\nCreado desde una tarea de Worktree Kanban.",
    "fr": "---\nCréé depuis une tâche Worktree Kanban.",
    "zh": "---\n由 Worktree Kanban 的任务创建。"
  },
  "PR を更新": {
    "en": "Update PR",
    "es": "Actualizar PR",
    "fr": "Mettre à jour la PR",
    "zh": "更新 PR"
  },
  "PR を作成": {
    "en": "Create PR",
    "es": "Crear PR",
    "fr": "Créer une PR",
    "zh": "创建 PR"
  },
  "GitHub にプルリクエストを作ります（gh を使います）。": {
    "en": "Create a pull request on GitHub (using gh).",
    "es": "Crea un pull request en GitHub (con gh).",
    "fr": "Crée une pull request sur GitHub (avec gh).",
    "zh": "在 GitHub 上创建拉取请求（使用 gh）。"
  },
  "PR のマージ先（base）": {
    "en": "PR base branch",
    "es": "Rama base del PR",
    "fr": "Branche de base de la PR",
    "zh": "PR 的合并目标（base）"
  },
  "タイトル": {
    "en": "Title",
    "es": "Título",
    "fr": "Titre",
    "zh": "标题"
  },
  "本文": {
    "en": "Body",
    "es": "Cuerpo",
    "fr": "Corps",
    "zh": "正文"
  },
  " PR を作ったあともタスクを続ける（worktree とブランチを残す）": {
    "en": " Keep working on the task after the PR is created (keep the worktree and branch)",
    "es": " Seguir con la tarea después de crear el PR (conservar el worktree y la rama)",
    "fr": " Continuer la tâche après la création de la PR (garder le worktree et la branche)",
    "zh": " 创建 PR 后继续此任务（保留 worktree 和分支）"
  },
  "push して更新": {
    "en": "Push and update",
    "es": "Push y actualizar",
    "fr": "Pousser et mettre à jour",
    "zh": "push 并更新"
  },
  "レビューで直しが入ったら、追加指示を送ってからもう一度このボタンを押すと PR に反映されます。": {
    "en": "After review changes, send a follow-up instruction and press this button again to update the PR.",
    "es": "Si la revisión pide cambios, envía una instrucción adicional y pulsa este botón otra vez para actualizar el PR.",
    "fr": "Si la revue demande des corrections, envoyez une instruction supplémentaire puis appuyez de nouveau sur ce bouton pour mettre à jour la PR.",
    "zh": "评审中有修改时，先发送追加指示，再按一次此按钮即可更新 PR。"
  },
  "push して PR を更新しています…": {
    "en": "Pushing and updating the PR…",
    "es": "Haciendo push y actualizando el PR…",
    "fr": "Push et mise à jour de la PR…",
    "zh": "正在 push 并更新 PR…"
  },
  "push して PR を作成しています…": {
    "en": "Pushing and creating the PR…",
    "es": "Haciendo push y creando el PR…",
    "fr": "Push et création de la PR…",
    "zh": "正在 push 并创建 PR…"
  },
  "PR を作成しました": {
    "en": "PR created",
    "es": "PR creado",
    "fr": "PR créée",
    "zh": "已创建 PR"
  },
  "PR を更新しました": {
    "en": "PR updated",
    "es": "PR actualizado",
    "fr": "PR mise à jour",
    "zh": "已更新 PR"
  },
  "{name} を使う": {
    "en": "Use {name}",
    "es": "Usar {name}",
    "fr": "Utiliser {name}",
    "zh": "使用 {name}"
  },
  "残しておきたいときは、タブの右の「＋」から開いてください。": {
    "en": "To keep it open, use + on the right of the tabs.",
    "es": "Si quieres dejarla abierta, ábrela con + a la derecha de las pestañas.",
    "fr": "Pour la garder ouverte, ouvrez-la avec + à droite des onglets.",
    "zh": "若想保留，请用标签右侧的“＋”打开。"
  },
  "このマシンで最近開いたリポジトリ": {
    "en": "Repositories opened recently on this machine",
    "es": "Repositorios abiertos hace poco en esta máquina",
    "fr": "Dépôts ouverts récemment sur cette machine",
    "zh": "此电脑最近打开的仓库"
  },
  "最近開いたリポジトリ": {
    "en": "Recently opened repositories",
    "es": "Repositorios abiertos recientemente",
    "fr": "Dépôts ouverts récemment",
    "zh": "最近打开的仓库"
  },
  "開いています": {
    "en": "Open",
    "es": "Abierto",
    "fr": "Ouvert",
    "zh": "已打开"
  },
  "タブにあります": {
    "en": "On a tab",
    "es": "En una pestaña",
    "fr": "Dans un onglet",
    "zh": "已在标签中"
  },
  "または新しく開く": {
    "en": "Or open a new one",
    "es": "O abrir uno nuevo",
    "fr": "Ou en ouvrir un nouveau",
    "zh": "或打开新的"
  },
  "ホストのリポジトリを選ぶ": {
    "en": "Choose a repository on the host",
    "es": "Elegir un repositorio del host",
    "fr": "Choisir un dépôt de l'hôte",
    "zh": "选择主机上的仓库"
  },
  "このマシンのリポジトリを選ぶ": {
    "en": "Choose a repository on this machine",
    "es": "Elegir un repositorio de esta máquina",
    "fr": "Choisir un dépôt de cette machine",
    "zh": "选择此电脑上的仓库"
  },
  "リポジトリを選ぶ": {
    "en": "Choose a repository",
    "es": "Elegir un repositorio",
    "fr": "Choisir un dépôt",
    "zh": "选择仓库"
  },
  "このマシンのフォルダを選びます。エージェントはこのマシンで、ホストのタスクと並んで動きます。このマシンのタブはホストには表示されません。": {
    "en": "Choose a folder on this machine. Agents run here alongside the host's tasks. Tabs on this machine are not shown on the host.",
    "es": "Elige una carpeta de esta máquina. Los agentes se ejecutan aquí junto a las tareas del host. Las pestañas de esta máquina no se muestran en el host.",
    "fr": "Choisissez un dossier sur cette machine. Les agents s'exécutent ici à côté des tâches de l'hôte. Les onglets de cette machine ne s'affichent pas sur l'hôte.",
    "zh": "选择此电脑上的文件夹。代理在此电脑上与主机的任务并排运行。此电脑的标签不会显示在主机上。"
  },
  "選んだフォルダが WSL の中なら、git とエージェント（claude / codex / gemini / cursor-agent）も WSL の中で動かします（WSL の中にも git と使うエージェントが必要です）。": {
    "en": "If the folder is inside WSL, git and the agents (claude / codex / gemini / cursor-agent) also run inside WSL (git and the agents you use must be installed in WSL too).",
    "es": "Si la carpeta está dentro de WSL, git y los agentes (claude / codex / gemini / cursor-agent) también se ejecutan dentro de WSL (git y los agentes que uses también deben estar en WSL).",
    "fr": "Si le dossier est dans WSL, git et les agents (claude / codex / gemini / cursor-agent) s'exécutent aussi dans WSL (git et les agents utilisés doivent aussi être installés dans WSL).",
    "zh": "如果所选文件夹在 WSL 中，git 和代理（claude / codex / gemini / cursor-agent）也会在 WSL 中运行（WSL 里也需要安装 git 和所用代理）。"
  },
  "ホストのフォルダを開く": {
    "en": "Open a folder on the host",
    "es": "Abrir una carpeta del host",
    "fr": "Ouvrir un dossier de l'hôte",
    "zh": "打开主机上的文件夹"
  },
  "このパソコンのフォルダを開く": {
    "en": "Open a folder on this computer",
    "es": "Abrir una carpeta de este ordenador",
    "fr": "Ouvrir un dossier de cet ordinateur",
    "zh": "打开这台电脑上的文件夹"
  },
  "手元のフォルダを開く": {
    "en": "Open a local folder",
    "es": "Abrir una carpeta local",
    "fr": "Ouvrir un dossier local",
    "zh": "打开本地文件夹"
  },
  "C:\\Users\\… など": {
    "en": "C:\\Users\\… and similar",
    "es": "C:\\Users\\… y similares",
    "fr": "C:\\Users\\… et similaires",
    "zh": "C:\\Users\\… 等"
  },
  "git リポジトリ、または git で管理していないフォルダ": {
    "en": "A git repository, or a folder not managed by git",
    "es": "Un repositorio git, o una carpeta no gestionada con git",
    "fr": "Un dépôt git, ou un dossier non géré par git",
    "zh": "git 仓库，或未用 git 管理的文件夹"
  },
  "URL からクローンする": {
    "en": "Clone from a URL",
    "es": "Clonar desde una URL",
    "fr": "Cloner depuis une URL",
    "zh": "从 URL 克隆"
  },
  "https://github.com/owner/repo・git@github.com:owner/repo.git・owner/repo": {
    "en": "https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo",
    "es": "https://github.com/owner/repo, git@github.com:owner/repo.git u owner/repo",
    "fr": "https://github.com/owner/repo, git@github.com:owner/repo.git ou owner/repo",
    "zh": "https://github.com/owner/repo、git@github.com:owner/repo.git 或 owner/repo"
  },
  "新しく作る": {
    "en": "Create new",
    "es": "Crear nuevo",
    "fr": "Créer",
    "zh": "新建"
  },
  "空のリポジトリ（GitHub にも作れます）か、git で管理しないフォルダを作ります": {
    "en": "Create an empty repository (it can also be created on GitHub) or a folder not managed by git",
    "es": "Crea un repositorio vacío (también se puede crear en GitHub) o una carpeta no gestionada con git",
    "fr": "Crée un dépôt vide (il peut aussi être créé sur GitHub) ou un dossier non géré par git",
    "zh": "创建空仓库（也可以在 GitHub 上创建），或不由 git 管理的文件夹"
  },
  "このフォルダを選ぶ": {
    "en": "Choose this folder",
    "es": "Elegir esta carpeta",
    "fr": "Choisir ce dossier",
    "zh": "选择此文件夹"
  },
  "移動": {
    "en": "Go",
    "es": "Ir",
    "fr": "Aller",
    "zh": "转到"
  },
  "↑ 上のフォルダ": {
    "en": "↑ Parent folder",
    "es": "↑ Carpeta superior",
    "fr": "↑ Dossier parent",
    "zh": "↑ 上级文件夹"
  },
  "ホーム": {
    "en": "Home",
    "es": "Inicio",
    "fr": "Accueil",
    "zh": "主目录"
  },
  " 隠しフォルダも出す": {
    "en": " Show hidden folders too",
    "es": " Mostrar también carpetas ocultas",
    "fr": " Afficher aussi les dossiers cachés",
    "zh": " 也显示隐藏文件夹"
  },
  "git リポジトリ": {
    "en": "Git repository",
    "es": "Repositorio git",
    "fr": "Dépôt git",
    "zh": "git 仓库"
  },
  "開く": {
    "en": "Open",
    "es": "Abrir",
    "fr": "Ouvrir",
    "zh": "打开"
  },
  "この中にフォルダはありません": {
    "en": "There are no folders here",
    "es": "No hay carpetas aquí",
    "fr": "Il n'y a pas de dossier ici",
    "zh": "这里没有文件夹"
  },
  "フォルダが多いので、先頭の分だけ出しています。パスを入れて移動してください": {
    "en": "There are many folders, so only the first ones are shown. Enter a path to go there",
    "es": "Hay muchas carpetas, así que solo se muestran las primeras. Escribe una ruta para ir",
    "fr": "Il y a beaucoup de dossiers, donc seuls les premiers sont affichés. Saisissez un chemin pour y aller",
    "zh": "文件夹很多，只显示了前面一部分。请输入路径再转到"
  },
  "ホストのフォルダを読み込んでいます…": {
    "en": "Loading folders on the host…",
    "es": "Cargando carpetas del host…",
    "fr": "Chargement des dossiers de l'hôte…",
    "zh": "正在读取主机上的文件夹…"
  },
  "戻る": {
    "en": "Back",
    "es": "Volver",
    "fr": "Retour",
    "zh": "返回"
  },
  "このフォルダを開く": {
    "en": "Open this folder",
    "es": "Abrir esta carpeta",
    "fr": "Ouvrir ce dossier",
    "zh": "打开此文件夹"
  },
  "リポジトリの URL": {
    "en": "Repository URL",
    "es": "URL del repositorio",
    "fr": "URL du dépôt",
    "zh": "仓库 URL"
  },
  "作る場所": {
    "en": "Where to create it",
    "es": "Dónde crearlo",
    "fr": "Où le créer",
    "zh": "创建位置"
  },
  "このパソコン": {
    "en": "This computer",
    "es": "Este ordenador",
    "fr": "Cet ordinateur",
    "zh": "这台电脑"
  },
  "置き場所（この中にフォルダを作ります）": {
    "en": "Location (a folder is created inside)",
    "es": "Ubicación (se crea una carpeta dentro)",
    "fr": "Emplacement (un dossier est créé dedans)",
    "zh": "存放位置（会在其中创建文件夹）"
  },
  "選ぶ…": {
    "en": "Choose…",
    "es": "Elegir…",
    "fr": "Choisir…",
    "zh": "选择…"
  },
  "フォルダ名（空なら URL から決めます）": {
    "en": "Folder name (taken from the URL if blank)",
    "es": "Nombre de la carpeta (si está vacío, se decide a partir de la URL)",
    "fr": "Nom du dossier (déduit de l'URL si vide)",
    "zh": "文件夹名（留空则根据 URL 决定）"
  },
  "例: my-app": {
    "en": "e.g. my-app",
    "es": "p. ej. my-app",
    "fr": "p. ex. my-app",
    "zh": "例：my-app"
  },
  "ソース管理": {
    "en": "Source control",
    "es": "Control de código",
    "fr": "Gestion du code",
    "zh": "源代码管理"
  },
  "git で管理する（タスクごとに worktree で作業し、マージ・PR で取り込む）": {
    "en": "Manage with git (each task works in a worktree, then is brought in by merge or PR)",
    "es": "Gestionar con git (cada tarea trabaja en un worktree y se incorpora con merge o PR)",
    "fr": "Gérer avec git (chaque tâche travaille dans un worktree, puis est intégrée par fusion ou PR)",
    "zh": "用 git 管理（每个任务在 worktree 中工作，再用合并或 PR 纳入）"
  },
  "git で管理しない（フォルダだけ作る。動画づくりなど、コード以外の作業に）": {
    "en": "Do not use git (create a folder only, for work other than code, such as making videos)",
    "es": "No usar git (solo crear una carpeta, para trabajo que no es código, como hacer vídeos)",
    "fr": "Ne pas utiliser git (créer seulement un dossier, pour un travail autre que du code, comme une vidéo)",
    "zh": "不用 git 管理（只创建文件夹。适合做视频等非代码工作）"
  },
  "git で管理しないフォルダでは、タスクはそのフォルダの中で直接動きます。差分・worktree・マージ・PR は使えず、終わったら「完了にする」で完了にします": {
    "en": "In a folder not managed by git, the task runs directly inside that folder. Diffs, worktrees, merge, and PR are unavailable. When it finishes, press Mark complete",
    "es": "En una carpeta no gestionada con git, la tarea se ejecuta directamente dentro. No hay diferencias, worktree, merge ni PR. Al terminar, pulsa Marcar como completada",
    "fr": "Dans un dossier non géré par git, la tâche s'exécute directement dedans. Différences, worktree, fusion et PR ne sont pas disponibles. À la fin, appuyez sur Marquer comme terminé",
    "zh": "在不用 git 管理的文件夹中，任务直接在该文件夹里运行。不能使用差异、worktree、合并和 PR。结束后按“标为完成”"
  },
  "作らない（手元だけ）": {
    "en": "Do not create one (local only)",
    "es": "No crearlo (solo en local)",
    "fr": "Ne pas le créer (en local seulement)",
    "zh": "不创建（仅本地）"
  },
  "GitHub にも作る（非公開）": {
    "en": "Also create it on GitHub (private)",
    "es": "Crearlo también en GitHub (privado)",
    "fr": "Le créer aussi sur GitHub (privé)",
    "zh": "也在 GitHub 上创建（私有）"
  },
  "GitHub にも作る（公開）": {
    "en": "Also create it on GitHub (public)",
    "es": "Crearlo también en GitHub (público)",
    "fr": "Le créer aussi sur GitHub (public)",
    "zh": "也在 GitHub 上创建（公开）"
  },
  "GitHub にも作るときは、gh（GitHub CLI）にログインしている必要があります": {
    "en": "Creating it on GitHub too requires that you are logged in to gh (GitHub CLI)",
    "es": "Para crearlo también en GitHub tienes que haber iniciado sesión en gh (GitHub CLI)",
    "fr": "Pour le créer aussi sur GitHub, vous devez être connecté à gh (GitHub CLI)",
    "zh": "若也在 GitHub 上创建，需要已登录 gh（GitHub CLI）"
  },
  "クローンして開く": {
    "en": "Clone and open",
    "es": "Clonar y abrir",
    "fr": "Cloner et ouvrir",
    "zh": "克隆并打开"
  },
  "作って開く": {
    "en": "Create and open",
    "es": "Crear y abrir",
    "fr": "Créer et ouvrir",
    "zh": "创建并打开"
  },
  "フォルダを作って開く": {
    "en": "Create the folder and open it",
    "es": "Crear la carpeta y abrirla",
    "fr": "Créer le dossier et l'ouvrir",
    "zh": "创建文件夹并打开"
  },
  "ここを置き場所にする": {
    "en": "Use this as the location",
    "es": "Usar esto como ubicación",
    "fr": "Utiliser ceci comme emplacement",
    "zh": "以此作为存放位置"
  },
  "クローンしています…（大きいリポジトリは時間がかかります）": {
    "en": "Cloning… (a large repository takes a while)",
    "es": "Clonando… (un repositorio grande tarda)",
    "fr": "Clonage… (un gros dépôt prend du temps)",
    "zh": "正在克隆…（大型仓库需要一些时间）"
  },
  "フォルダを作っています…": {
    "en": "Creating the folder…",
    "es": "Creando la carpeta…",
    "fr": "Création du dossier…",
    "zh": "正在创建文件夹…"
  },
  "リポジトリを作っています…": {
    "en": "Creating the repository…",
    "es": "Creando el repositorio…",
    "fr": "Création du dépôt…",
    "zh": "正在创建仓库…"
  },
  "クローンしました": {
    "en": "Cloned",
    "es": "Clonado",
    "fr": "Cloné",
    "zh": "已克隆"
  },
  "git で管理しないフォルダを作りました": {
    "en": "Created a folder not managed by git",
    "es": "Carpeta no gestionada con git creada",
    "fr": "Dossier non géré par git créé",
    "zh": "已创建不用 git 管理的文件夹"
  },
  "リポジトリを作り、GitHub にも push しました": {
    "en": "Created the repository and pushed it to GitHub",
    "es": "Repositorio creado y enviado a GitHub",
    "fr": "Dépôt créé et poussé vers GitHub",
    "zh": "已创建仓库并 push 到 GitHub"
  },
  "リポジトリを作りました": {
    "en": "Repository created",
    "es": "Repositorio creado",
    "fr": "Dépôt créé",
    "zh": "已创建仓库"
  },
  "たった今": {
    "en": "just now",
    "es": "ahora mismo",
    "fr": "à l'instant",
    "zh": "刚刚"
  },
  "実行": {
    "en": "Run",
    "es": "Ejecutar",
    "fr": "Exécuter",
    "zh": "执行"
  },
  "対応済み": {
    "en": "Handled",
    "es": "Atendido",
    "fr": "Traité",
    "zh": "已处理"
  },
  "通知": {
    "en": "Notifications",
    "es": "Avisos",
    "fr": "Notifications",
    "zh": "通知"
  },
  "すべて既読": {
    "en": "Mark all read",
    "es": "Marcar todo como leído",
    "fr": "Tout marquer comme lu",
    "zh": "全部标为已读"
  },
  "すべて消す": {
    "en": "Clear all",
    "es": "Borrar todo",
    "fr": "Tout effacer",
    "zh": "全部清除"
  },
  "通知はまだありません": {
    "en": "No notifications yet",
    "es": "Aún no hay avisos",
    "fr": "Pas encore de notification",
    "zh": "还没有通知"
  },
  "スキルの提案を頼んでいます…": {
    "en": "Asking for skill suggestions…",
    "es": "Pidiendo sugerencias de skills…",
    "fr": "Demande de suggestions de skills…",
    "zh": "正在请求技能建议…"
  },
  "スキルの提案を新しい会話で頼みました。返事が来たら、下の欄から追加したいものを伝えてください": {
    "en": "Skill suggestions were requested in a new conversation. When the reply arrives, say in the box below which ones to add",
    "es": "Se pidieron sugerencias de skills en una conversación nueva. Cuando llegue la respuesta, indica abajo cuáles quieres añadir",
    "fr": "Des suggestions de skills ont été demandées dans une nouvelle conversation. Quand la réponse arrive, indiquez ci-dessous celles à ajouter",
    "zh": "已在新对话中请求技能建议。收到回复后，请在下方栏中说明想添加哪些"
  },
  "コピーしました": {
    "en": "Copied",
    "es": "Copiado",
    "fr": "Copié",
    "zh": "已复制"
  },
  "コピー": {
    "en": "Copy",
    "es": "Copiar",
    "fr": "Copier",
    "zh": "复制"
  },
  "コピーできませんでした": {
    "en": "Could not copy",
    "es": "No se pudo copiar",
    "fr": "Impossible de copier",
    "zh": "无法复制"
  },
  "ターミナルで xcode-select --install を実行するか Homebrew で git": {
    "en": "Run xcode-select --install in a terminal, or install git with Homebrew",
    "es": "Ejecuta xcode-select --install en la terminal, o instala git con Homebrew",
    "fr": "Exécutez xcode-select --install dans un terminal, ou installez git avec Homebrew",
    "zh": "请在终端运行 xcode-select --install，或用 Homebrew 安装 git"
  },
  "日": {
    "en": "Sun",
    "es": "dom",
    "fr": "dim",
    "zh": "日"
  },
  "月": {
    "en": "Mon",
    "es": "lun",
    "fr": "lun",
    "zh": "一"
  },
  "火": {
    "en": "Tue",
    "es": "mar",
    "fr": "mar",
    "zh": "二"
  },
  "水": {
    "en": "Wed",
    "es": "mié",
    "fr": "mer",
    "zh": "三"
  },
  "木": {
    "en": "Thu",
    "es": "jue",
    "fr": "jeu",
    "zh": "四"
  },
  "金": {
    "en": "Fri",
    "es": "vie",
    "fr": "ven",
    "zh": "五"
  },
  "土": {
    "en": "Sat",
    "es": "sáb",
    "fr": "sam",
    "zh": "六"
  },
  "1回だけ {date} {time}": {
    "en": "Once on {date} at {time}",
    "es": "Una vez el {date} a las {time}",
    "fr": "Une fois le {date} à {time}",
    "zh": "仅一次 {date} {time}"
  },
  "毎時 {minute}分": {
    "en": "Every hour at minute {minute}",
    "es": "Cada hora en el minuto {minute}",
    "fr": "Toutes les heures à la minute {minute}",
    "zh": "每小时的第 {minute} 分"
  },
  "毎日 {time}": {
    "en": "Every day at {time}",
    "es": "Cada día a las {time}",
    "fr": "Chaque jour à {time}",
    "zh": "每天 {time}"
  },
  "毎週 {days} {time}": {
    "en": "Every week {days} {time}",
    "es": "Cada semana {days} {time}",
    "fr": "Chaque semaine {days} {time}",
    "zh": "每周 {days} {time}"
  },
  "毎月 {day}日 {time}（ない月は末日）": {
    "en": "Day {day} of every month at {time} (the last day if that day does not exist)",
    "es": "El día {day} de cada mes a las {time} (el último día si ese día no existe)",
    "fr": "Le {day} de chaque mois à {time} (le dernier jour si ce jour n'existe pas)",
    "zh": "每月 {day} 日 {time}（没有该日的月份则在月末）"
  },
  "毎月 {day}日 {time}": {
    "en": "Day {day} of every month at {time}",
    "es": "El día {day} de cada mes a las {time}",
    "fr": "Le {day} de chaque mois à {time}",
    "zh": "每月 {day} 日 {time}"
  },
  "先にリポジトリを選んでください": {
    "en": "Choose a repository first",
    "es": "Elige primero un repositorio",
    "fr": "Choisissez d'abord un dépôt",
    "zh": "请先选择仓库"
  },
  "指示を入力してください": {
    "en": "Enter instructions",
    "es": "Introduce las instrucciones",
    "fr": "Saisissez les instructions",
    "zh": "请输入指示"
  },
  "実行する日時を入力してください": {
    "en": "Enter the date and time to run",
    "es": "Introduce la fecha y la hora de ejecución",
    "fr": "Saisissez la date et l'heure d'exécution",
    "zh": "请输入要执行的日期和时间"
  },
  "曜日を1つ以上選んでください": {
    "en": "Choose at least one weekday",
    "es": "Elige al menos un día de la semana",
    "fr": "Choisissez au moins un jour de la semaine",
    "zh": "请至少选择一个星期"
  },
  "繰り返しの日時の値が正しくありません": {
    "en": "The repeat date or time is not valid",
    "es": "La fecha o la hora de repetición no es válida",
    "fr": "La date ou l'heure de répétition n'est pas valable",
    "zh": "重复的日期或时间不正确"
  },
  "繰り返しの種類を選んでください": {
    "en": "Choose a repeat type",
    "es": "Elige un tipo de repetición",
    "fr": "Choisissez un type de répétition",
    "zh": "请选择重复类型"
  },
  "1回だけ": {
    "en": "Once",
    "es": "Una vez",
    "fr": "Une fois",
    "zh": "仅一次"
  },
  "毎時": {
    "en": "Hourly",
    "es": "Cada hora",
    "fr": "Toutes les heures",
    "zh": "每小时"
  },
  "毎日": {
    "en": "Daily",
    "es": "Cada día",
    "fr": "Chaque jour",
    "zh": "每天"
  },
  "毎週": {
    "en": "Weekly",
    "es": "Cada semana",
    "fr": "Chaque semaine",
    "zh": "每周"
  },
  "毎月": {
    "en": "Monthly",
    "es": "Cada mes",
    "fr": "Chaque mois",
    "zh": "每月"
  },
  "見送り": {
    "en": "Skipped",
    "es": "Omitido",
    "fr": "Ignoré",
    "zh": "跳过"
  },
  "失敗": {
    "en": "Failed",
    "es": "Fallido",
    "fr": "Échec",
    "zh": "失败"
  },
  "実行する日時を入れてください": {
    "en": "Enter the date and time to run",
    "es": "Introduce la fecha y la hora de ejecución",
    "fr": "Saisissez la date et l'heure d'exécution",
    "zh": "请输入要执行的日期和时间"
  },
  "実行する日時に、過去の日時は指定できません": {
    "en": "The date and time to run cannot be in the past",
    "es": "La fecha y la hora de ejecución no pueden ser pasadas",
    "fr": "La date et l'heure d'exécution ne peuvent pas être dans le passé",
    "zh": "要执行的日期和时间不能是过去"
  },
  "分は 0〜59 の数字で入れてください": {
    "en": "Enter a minute from 0 to 59",
    "es": "Introduce un minuto de 0 a 59",
    "fr": "Saisissez une minute de 0 à 59",
    "zh": "分钟请输入 0 到 59 的数字"
  },
  "時刻を入れてください": {
    "en": "Enter a time",
    "es": "Introduce una hora",
    "fr": "Saisissez une heure",
    "zh": "请输入时间"
  },
  "日は 1〜31 の数字で入れてください": {
    "en": "Enter a day from 1 to 31",
    "es": "Introduce un día de 1 a 31",
    "fr": "Saisissez un jour de 1 à 31",
    "zh": "日期请输入 1 到 31 的数字"
  },
  "競争": {
    "en": "Compete",
    "es": "Competencia",
    "fr": "Concours",
    "zh": "竞争"
  },
  "Pipeline「{name}」": {
    "en": "Pipeline “{name}”",
    "es": "Pipeline «{name}»",
    "fr": "Pipeline « {name} »",
    "zh": "Pipeline“{name}”"
  },
  "Pipeline（見つかりません）": {
    "en": "Pipeline (not found)",
    "es": "Pipeline (no se encuentra)",
    "fr": "Pipeline (introuvable)",
    "zh": "Pipeline（找不到）"
  },
  "カスタムエージェント（見つかりません）": {
    "en": "Custom agent (not found)",
    "es": "Agente personalizado (no se encuentra)",
    "fr": "Agent personnalisé (introuvable)",
    "zh": "自定义代理（找不到）"
  },
  "停止中": {
    "en": "Paused",
    "es": "En pausa",
    "fr": "En pause",
    "zh": "已停止"
  },
  "前回は失敗": {
    "en": "The last run failed",
    "es": "La última ejecución falló",
    "fr": "La dernière exécution a échoué",
    "zh": "上次失败"
  },
  "最終実行日": {
    "en": "Last run",
    "es": "Última ejecución",
    "fr": "Dernière exécution",
    "zh": "上次执行"
  },
  "未実行": {
    "en": "Not run yet",
    "es": "Aún no ejecutado",
    "fr": "Pas encore exécuté",
    "zh": "尚未执行"
  },
  "まずリポジトリを選んでください": {
    "en": "Choose a repository first",
    "es": "Elige primero un repositorio",
    "fr": "Choisissez d'abord un dépôt",
    "zh": "请先选择仓库"
  },
  "スケジュールはリポジトリごとに管理します。リポジトリを開くと、ここにそのリポジトリのスケジュールが出ます。": {
    "en": "Schedules are kept per repository. Open a repository to see its schedules here.",
    "es": "Los horarios se gestionan por repositorio. Abre un repositorio para ver aquí sus horarios.",
    "fr": "Les planifications sont gérées par dépôt. Ouvrez un dépôt pour voir ici ses planifications.",
    "zh": "日程按仓库管理。打开仓库后，这里会显示该仓库的日程。"
  },
  "タスクスケジューラ": {
    "en": "Task scheduler",
    "es": "Programador de tareas",
    "fr": "Planificateur de tâches",
    "zh": "任务日程"
  },
  "決めた日時に、カンバンにタスクを作って開始します。アプリを起動しているあいだだけ動きます。": {
    "en": "At the chosen time, a task is created on the board and started. This runs only while the app is open.",
    "es": "A la hora elegida, se crea una tarea en el tablero y se inicia. Solo funciona mientras la aplicación está abierta.",
    "fr": "À l'heure choisie, une tâche est créée sur le tableau et démarrée. Cela ne fonctionne que pendant que l'application est ouverte.",
    "zh": "到了设定的时间，会在看板上创建任务并开始。只在应用处于打开状态时运行。"
  },
  "新しいスケジュール": {
    "en": "New schedule",
    "es": "Nuevo horario",
    "fr": "Nouvelle planification",
    "zh": "新日程"
  },
  "スケジュールはまだありません。「新しいスケジュール」か、カンバンのタスク詳細の「スケジュール登録」から作れます。": {
    "en": "No schedules yet. Create one with New schedule, or with Add schedule on a task's detail on the board.",
    "es": "Aún no hay horarios. Puedes crear uno con Nuevo horario o con Registrar horario en el detalle de una tarea del tablero.",
    "fr": "Pas encore de planification. Créez-en une avec Nouvelle planification, ou avec Enregistrer une planification dans le détail d'une tâche du tableau.",
    "zh": "还没有日程。可以用“新日程”，或在看板任务详情中用“登记日程”来创建。"
  },
  "カードを開く": {
    "en": "Open card",
    "es": "Abrir tarjeta",
    "fr": "Ouvrir la carte",
    "zh": "打开卡片"
  },
  "カードは削除済み": {
    "en": "Card deleted",
    "es": "Tarjeta eliminada",
    "fr": "Carte supprimée",
    "zh": "卡片已删除"
  },
  "予定なし": {
    "en": "No upcoming run",
    "es": "Sin próxima ejecución",
    "fr": "Aucune exécution prévue",
    "zh": "没有预定"
  },
  "停止": {
    "en": "Pause",
    "es": "Pausar",
    "fr": "Mettre en pause",
    "zh": "停止"
  },
  "日時が過ぎています。「編集」で日時を変えてください": {
    "en": "That date and time have passed. Change them in Edit",
    "es": "Esa fecha y hora ya pasaron. Cámbialas en Editar",
    "fr": "Cette date et cette heure sont passées. Modifiez-les dans Modifier",
    "zh": "日期和时间已过。请在“编辑”中修改"
  },
  "再開": {
    "en": "Resume",
    "es": "Reanudar",
    "fr": "Reprendre",
    "zh": "恢复"
  },
  "繰り返し": {
    "en": "Repeat",
    "es": "Repetición",
    "fr": "Répétition",
    "zh": "重复"
  },
  "次回の実行": {
    "en": "Next run",
    "es": "Próxima ejecución",
    "fr": "Prochaine exécution",
    "zh": "下次执行"
  },
  "スキル": {
    "en": "Skill",
    "es": "Skill",
    "fr": "Skill",
    "zh": "技能"
  },
  "なし": {
    "en": "None",
    "es": "Ninguno",
    "fr": "Aucun",
    "zh": "无"
  },
  "動かし方": {
    "en": "How it runs",
    "es": "Cómo se ejecuta",
    "fr": "Façon de l'exécuter",
    "zh": "运行方式"
  },
  "ソースを変更しない": {
    "en": "Do not change source",
    "es": "No cambiar el código",
    "fr": "Ne pas modifier le code",
    "zh": "不修改源代码"
  },
  "起動後に1回だけ追いつく": {
    "en": "Catch up once after launch",
    "es": "Ponerse al día una vez al abrir",
    "fr": "Rattraper une fois après le lancement",
    "zh": "启动后补跑一次"
  },
  "通常": {
    "en": "Normal",
    "es": "Normal",
    "fr": "Normal",
    "zh": "通常"
  },
  "指示内容": {
    "en": "Instructions",
    "es": "Instrucciones",
    "fr": "Instructions",
    "zh": "指示内容"
  },
  "実行履歴": {
    "en": "Run history",
    "es": "Historial de ejecución",
    "fr": "Historique d'exécution",
    "zh": "执行记录"
  },
  "まだ実行していません": {
    "en": "Not run yet",
    "es": "Aún no se ha ejecutado",
    "fr": "Pas encore exécuté",
    "zh": "尚未执行"
  },
  "削除": {
    "en": "Delete",
    "es": "Eliminar",
    "fr": "Supprimer",
    "zh": "删除"
  },
  "編集": {
    "en": "Edit",
    "es": "Editar",
    "fr": "Modifier",
    "zh": "编辑"
  },
  "カンバンにタスクを作ります。開始はしません": {
    "en": "Create a task on the board without starting it",
    "es": "Crea una tarea en el tablero sin iniciarla",
    "fr": "Crée une tâche sur le tableau sans la démarrer",
    "zh": "在看板上创建任务，但不开始"
  },
  "タスクだけ作成": {
    "en": "Create the task only",
    "es": "Crear solo la tarea",
    "fr": "Créer seulement la tâche",
    "zh": "仅创建任务"
  },
  "カンバンにタスクを作って、すぐに開始します": {
    "en": "Create a task on the board and start it now",
    "es": "Crea una tarea en el tablero e iníciala ahora",
    "fr": "Crée une tâche sur le tableau et démarre-la tout de suite",
    "zh": "在看板上创建任务并立即开始"
  },
  "今すぐ実行": {
    "en": "Run now",
    "es": "Ejecutar ahora",
    "fr": "Exécuter maintenant",
    "zh": "立即执行"
  },
  "タスクを作って開始しています…": {
    "en": "Creating and starting the task…",
    "es": "Creando e iniciando la tarea…",
    "fr": "Création et démarrage de la tâche…",
    "zh": "正在创建并开始任务…"
  },
  "タスクを作って開始しました": {
    "en": "Task created and started",
    "es": "Tarea creada e iniciada",
    "fr": "Tâche créée et démarrée",
    "zh": "已创建并开始任务"
  },
  "カンバンにタスクを作成しました": {
    "en": "Task created on the board",
    "es": "Tarea creada en el tablero",
    "fr": "Tâche créée sur le tableau",
    "zh": "已在看板上创建任务"
  },
  "保存しています…": {
    "en": "Saving…",
    "es": "Guardando…",
    "fr": "Enregistrement…",
    "zh": "正在保存…"
  },
  "停止しました": {
    "en": "Paused",
    "es": "En pausa",
    "fr": "Mis en pause",
    "zh": "已停止"
  },
  "再開しました": {
    "en": "Resumed",
    "es": "Reanudado",
    "fr": "Repris",
    "zh": "已恢复"
  },
  "スケジュール「{title}」を削除しますか？\n作成済みのタスクは残ります。": {
    "en": "Delete the schedule “{title}”?\nTasks already created will remain.",
    "es": "¿Eliminar el horario «{title}»?\nLas tareas ya creadas se quedan.",
    "fr": "Supprimer la planification « {title} » ?\nLes tâches déjà créées restent.",
    "zh": "要删除日程“{title}”吗？\n已创建的任务会保留。"
  },
  "削除しています…": {
    "en": "Deleting…",
    "es": "Eliminando…",
    "fr": "Suppression…",
    "zh": "正在删除…"
  },
  "削除しました": {
    "en": "Deleted",
    "es": "Eliminado",
    "fr": "Supprimé",
    "zh": "已删除"
  },
  "実行する日時": {
    "en": "Date and time to run",
    "es": "Fecha y hora de ejecución",
    "fr": "Date et heure d'exécution",
    "zh": "要执行的日期和时间"
  },
  "毎時の何分に実行するか（0〜59）": {
    "en": "Minute of each hour to run (0–59)",
    "es": "En qué minuto de cada hora se ejecuta (0–59)",
    "fr": "À quelle minute de chaque heure l'exécuter (0–59)",
    "zh": "每小时的第几分钟执行（0–59）"
  },
  "曜日（複数選べます）": {
    "en": "Weekdays (you can choose more than one)",
    "es": "Días de la semana (puedes elegir varios)",
    "fr": "Jours de la semaine (plusieurs possibles)",
    "zh": "星期（可多选）"
  },
  "毎月の何日に実行するか（1〜31）": {
    "en": "Day of each month to run (1–31)",
    "es": "Qué día de cada mes se ejecuta (1–31)",
    "fr": "Quel jour de chaque mois l'exécuter (1–31)",
    "zh": "每月的第几天执行（1–31）"
  },
  "月の日数より大きいときは、その月の末日に実行します": {
    "en": "If the day is past the end of a month, it runs on that month's last day",
    "es": "Si el día supera los días del mes, se ejecuta el último día de ese mes",
    "fr": "Si le jour dépasse la fin du mois, l'exécution a lieu le dernier jour de ce mois",
    "zh": "若大于该月的天数，则在该月的最后一天执行"
  },
  "時刻（この PC の時刻）": {
    "en": "Time (this PC's clock)",
    "es": "Hora (la de este PC)",
    "fr": "Heure (celle de ce PC)",
    "zh": "时间（此电脑的时间）"
  },
  "ソースを変更しないタスクでは、競争は使えません。ほかのエージェントを選んでください": {
    "en": "Compete cannot be used for a task that does not change source. Choose another agent",
    "es": "La competencia no se puede usar en una tarea que no cambia el código. Elige otro agente",
    "fr": "Le concours ne peut pas être utilisé pour une tâche qui ne modifie pas le code. Choisissez un autre agent",
    "zh": "不修改源代码的任务不能使用竞争。请选择其他代理"
  },
  "ソースを変更しないタスクでは、並列のあるPipelineは使えません。ほかのエージェントを選んでください": {
    "en": "A Pipeline with a parallel cannot be used for a task that does not change source. Choose another agent",
    "es": "Un Pipeline con un paralelo no se puede usar en una tarea que no cambia el código. Elige otro agente",
    "fr": "Un Pipeline avec un parallèle ne peut pas être utilisé pour une tâche qui ne modifie pas le code. Choisissez un autre agent",
    "zh": "不修改源代码的任务不能使用含并行的 Pipeline。请选择其他代理"
  },
  "スケジュールを編集": {
    "en": "Edit schedule",
    "es": "Editar horario",
    "fr": "Modifier la planification",
    "zh": "编辑日程"
  },
  "タスク「{title}」の内容をコピーして登録します。元のタスクはそのまま残ります。": {
    "en": "This registers a copy of the task “{title}”. The original task stays as it is.",
    "es": "Esto registra una copia de la tarea «{title}». La tarea original se queda igual.",
    "fr": "Ceci enregistre une copie de la tâche « {title} ». La tâche d'origine reste telle quelle.",
    "zh": "将复制任务“{title}”的内容并登记。原任务保持不变。"
  },
  "添付ファイル（{n} 件）はコピーしません。": {
    "en": "Attachments ({n}) are not copied.",
    "es": "Los archivos adjuntos ({n}) no se copian.",
    "fr": "Les pièces jointes ({n}) ne sont pas copiées.",
    "zh": "不会复制附件（{n} 个）。"
  },
  "タスク名（省略すると指示の1行目）": {
    "en": "Task name (the first line of the instructions if left blank)",
    "es": "Nombre de la tarea (si se omite, la primera línea de las instrucciones)",
    "fr": "Nom de la tâche (la première ligne des instructions s'il est vide)",
    "zh": "任务名（留空则用指示的第一行）"
  },
  "毎回エージェントに頼むことを具体的に書いてください。": {
    "en": "Describe in detail what to ask the agent each time.",
    "es": "Describe con detalle lo que hay que pedir al agente cada vez.",
    "fr": "Décrivez précisément ce qu'il faut demander à l'agent à chaque fois.",
    "zh": "请具体写下每次要让代理做的事。"
  },
  "SQL を作るだけ・調べるだけなど、ソースコードを変えないタスクにします": {
    "en": "Make this a task that does not change source code, such as writing SQL or looking something up",
    "es": "Haz que sea una tarea que no cambia el código, como crear SQL o investigar",
    "fr": "Faites-en une tâche qui ne modifie pas le code, comme écrire du SQL ou chercher une information",
    "zh": "设为不修改源代码的任务，例如只生成 SQL 或只做调查"
  },
  "アプリを閉じていた・スリープしていたなどで10分より遅れたときは、ふつうは見送って次回へ進みます。チェックを付けると、起動してから1回だけ実行します": {
    "en": "If the app was closed or asleep and the time is more than 10 minutes late, the run is usually skipped and the next one is scheduled. Check this to run it once after the app starts",
    "es": "Si la aplicación estaba cerrada o en reposo y se retrasó más de 10 minutos, normalmente se omite y se pasa a la siguiente. Márcalo para ejecutarla una vez al abrir",
    "fr": "Si l'application était fermée ou en veille et que l'heure a plus de 10 minutes de retard, l'exécution est en général ignorée et on passe à la suivante. Cochez pour l'exécuter une fois après le lancement",
    "zh": "如果因为应用关闭或休眠而晚了超过 10 分钟，通常会跳过并等到下一次。勾选后，会在启动后补跑一次"
  },
  "時刻を過ぎていたら、起動後に1回だけ追いつく": {
    "en": "If the time has passed, catch up once after launch",
    "es": "Si la hora ya pasó, ponerse al día una vez al abrir",
    "fr": "Si l'heure est passée, rattraper une fois après le lancement",
    "zh": "若时间已过，启动后补跑一次"
  },
  "登録": {
    "en": "Add",
    "es": "Registrar",
    "fr": "Enregistrer",
    "zh": "登记"
  },
  "保存（Ctrl/⌘ + Enter）": {
    "en": "Save (Ctrl/⌘ + Enter)",
    "es": "Guardar (Ctrl/⌘ + Enter)",
    "fr": "Enregistrer (Ctrl/⌘ + Entrée)",
    "zh": "保存（Ctrl/⌘ + Enter）"
  },
  "登録（Ctrl/⌘ + Enter）": {
    "en": "Add (Ctrl/⌘ + Enter)",
    "es": "Registrar (Ctrl/⌘ + Enter)",
    "fr": "Enregistrer (Ctrl/⌘ + Entrée)",
    "zh": "登记（Ctrl/⌘ + Enter）"
  },
  "元の指定（{name}）は今は選べないので、別のものを選んでいます。確かめてから保存してください。": {
    "en": "The original choice ({name}) cannot be selected now, so another one is selected. Check it before saving.",
    "es": "La elección original ({name}) ya no se puede seleccionar, así que hay otra elegida. Revísala antes de guardar.",
    "fr": "Le choix d'origine ({name}) ne peut plus être sélectionné, donc un autre est choisi. Vérifiez avant d'enregistrer.",
    "zh": "原来的选择（{name}）现在无法选中，已改选其他项。请确认后再保存。"
  },
  "エージェントへの指示を入れてください": {
    "en": "Enter instructions for the agent",
    "es": "Introduce las instrucciones para el agente",
    "fr": "Saisissez les instructions pour l'agent",
    "zh": "请输入给代理的指示"
  },
  "スケジュールを保存しています…": {
    "en": "Saving the schedule…",
    "es": "Guardando el horario…",
    "fr": "Enregistrement de la planification…",
    "zh": "正在保存日程…"
  },
  "保存しました": {
    "en": "Saved",
    "es": "Guardado",
    "fr": "Enregistré",
    "zh": "已保存"
  },
  "スケジュールを登録しました": {
    "en": "Schedule added",
    "es": "Horario registrado",
    "fr": "Planification enregistrée",
    "zh": "已登记日程"
  }
});

(typeof module === 'object' && module.exports ? require('../i18n.js') : I18n).add({
  "会話を始める": {
    "en": "Start a conversation",
    "es": "Empezar una conversación",
    "fr": "Commencer une conversation",
    "zh": "开始对话"
  },
  "例: このリポジトリの全体の構成を教えて（画像やファイルは貼り付け・ドラッグ＆ドロップでも添付できます）": {
    "en": "e.g. Explain the overall structure of this repository (you can also attach images and files by pasting or dragging them)",
    "es": "p. ej. Explica la estructura general de este repositorio (también puedes adjuntar imágenes y archivos pegándolos o arrastrándolos)",
    "fr": "p. ex. Expliquez la structure générale de ce dépôt (vous pouvez aussi joindre des images et des fichiers en les collant ou en les déposant)",
    "zh": "例：说明此仓库的整体结构（也可以通过粘贴或拖放附加图片和文件）"
  },
  "このスキルを使って実行します": {
    "en": "Run with this skill",
    "es": "Ejecutar con este skill",
    "fr": "Exécuter avec ce skill",
    "zh": "使用此技能执行"
  },
  "スキルを外す": {
    "en": "Remove the skill",
    "es": "Quitar el skill",
    "fr": "Retirer le skill",
    "zh": "移除技能"
  },
  "名前や説明で絞り込む": {
    "en": "Filter by name or description",
    "es": "Filtrar por nombre o descripción",
    "fr": "Filtrer par nom ou description",
    "zh": "按名称或说明筛选"
  },
  "「{title}」の次の実行を、選んだ会話の続きとして始めます。": {
    "en": "The next run of “{title}” will continue from the conversation you choose.",
    "es": "La próxima ejecución de «{title}» continuará desde la conversación que elijas.",
    "fr": "La prochaine exécution de « {title} » continuera la conversation choisie.",
    "zh": "“{title}”的下次执行将从所选对话继续。"
  },
  "← 引き継ぎ: {label}": {
    "en": "← continued: {label}",
    "es": "← continuación: {label}",
    "fr": "← reprise : {label}",
    "zh": "← 接续：{label}"
  },
  "会話 {n}（{time}） {label}": {
    "en": "Conversation {n} ({time}) {label}",
    "es": "Conversación {n} ({time}) {label}",
    "fr": "Conversation {n} ({time}) {label}",
    "zh": "对话 {n}（{time}） {label}"
  },
  "引き継ぐ: {label}": {
    "en": "Continue: {label}",
    "es": "Continuar: {label}",
    "fr": "Reprendre : {label}",
    "zh": "接续：{label}"
  },
  "{n} 件を選択中": {
    "en": "{n} selected",
    "es": "{n} seleccionadas",
    "fr": "{n} sélectionnées",
    "zh": "已选 {n} 项"
  },
  "タスク「{title}」 ほか {n} 件": {
    "en": "Task “{title}” and {n} more",
    "es": "Tarea «{title}» y {n} más",
    "fr": "Tâche « {title} » et {n} de plus",
    "zh": "任务“{title}”及其他 {n} 项"
  },
  "タスク「{title}」": {
    "en": "Task “{title}”",
    "es": "Tarea «{title}»",
    "fr": "Tâche « {title} »",
    "zh": "任务“{title}”"
  },
  "選んだ {n} 件の会話を消しますか？\n消した会話は元に戻せません。\n（{used} 件はタスクが使っています。そのタスクは次から新しい会話で始めます）": {
    "en": "Delete the {n} selected conversations?\nDeleted conversations cannot be restored.\n({used} are used by tasks. Those tasks will start a new conversation next time)",
    "es": "¿Eliminar las {n} conversaciones seleccionadas?\nLas conversaciones eliminadas no se pueden restaurar.\n({used} las usan tareas. Esas tareas empezarán una conversación nueva la próxima vez)",
    "fr": "Supprimer les {n} conversations sélectionnées ?\nLes conversations supprimées ne peuvent pas être restaurées.\n({used} sont utilisées par des tâches. Ces tâches commenceront une nouvelle conversation la prochaine fois)",
    "zh": "要删除所选的 {n} 个对话吗？\n删除后无法恢复。\n（其中 {used} 个正被任务使用。那些任务下次会用新对话开始）"
  },
  "選んだ {n} 件の会話を消しますか？\n消した会話は元に戻せません。": {
    "en": "Delete the {n} selected conversations?\nDeleted conversations cannot be restored.",
    "es": "¿Eliminar las {n} conversaciones seleccionadas?\nLas conversaciones eliminadas no se pueden restaurar.",
    "fr": "Supprimer les {n} conversations sélectionnées ?\nLes conversations supprimées ne peuvent pas être restaurées.",
    "zh": "要删除所选的 {n} 个对话吗？\n删除后无法恢复。"
  },
  "{n} 件の会話を消しました（実行中で使っている {skipped} 件は消していません）": {
    "en": "Deleted {n} conversations ({skipped} in use by a running task were kept)",
    "es": "Se eliminaron {n} conversaciones ({skipped} en uso por una tarea en ejecución se conservaron)",
    "fr": "{n} conversations supprimées ({skipped} utilisées par une tâche en cours ont été conservées)",
    "zh": "已删除 {n} 个对话（正在运行的任务使用的 {skipped} 个未删除）"
  },
  "{n} 件の会話を消しました": {
    "en": "Deleted {n} conversations",
    "es": "Se eliminaron {n} conversaciones",
    "fr": "{n} conversations supprimées",
    "zh": "已删除 {n} 个对话"
  },
  "{n} 件のタスクを Issue から作りました": {
    "en": "Created {n} tasks from Issues",
    "es": "Se crearon {n} tareas desde Issues",
    "fr": "{n} tâches créées depuis des Issues",
    "zh": "已从 Issue 创建 {n} 个任务"
  },
  "例: 12 または 12, 15, 18": {
    "en": "e.g. 12 or 12, 15, 18",
    "es": "p. ej. 12 o 12, 15, 18",
    "fr": "p. ex. 12 ou 12, 15, 18",
    "zh": "例：12 或 12, 15, 18"
  },
  "例: 変更したらテストを追加して npm test で確認して": {
    "en": "e.g. If you change it, add a test and check it with npm test",
    "es": "p. ej. Si lo cambias, añade una prueba y compruébala con npm test",
    "fr": "p. ex. Si vous le modifiez, ajoutez un test et vérifiez avec npm test",
    "zh": "例：如果有修改，请添加测试并用 npm test 确认"
  },
  "{owner}/{repo} の Issue を読み込みます。": {
    "en": "Issues from {owner}/{repo} will be loaded.",
    "es": "Se cargarán los Issues de {owner}/{repo}.",
    "fr": "Les Issues de {owner}/{repo} seront chargés.",
    "zh": "将读取 {owner}/{repo} 的 Issue。"
  },
  "ほかのタスクのブランチ": {
    "en": "Branches of other tasks",
    "es": "Ramas de otras tareas",
    "fr": "Branches d'autres tâches",
    "zh": "其他任务的分支"
  },
  "新しいブランチの名前（{base} から作ります）": {
    "en": "Name of the new branch (created from {base})",
    "es": "Nombre de la rama nueva (se crea desde {base})",
    "fr": "Nom de la nouvelle branche (créée depuis {base})",
    "zh": "新分支的名称（从 {base} 创建）"
  },
  "例: feature/login-improvements": {
    "en": "e.g. feature/login-improvements",
    "es": "p. ej. feature/login-improvements",
    "fr": "p. ex. feature/login-improvements",
    "zh": "例：feature/login-improvements"
  },
  "origin の最新を取り込んでからローカルの {target} にマージし、origin/{target} に push します。": {
    "en": "The latest origin will be fetched, then merged into local {target}, and pushed to origin/{target}.",
    "es": "Se traerá lo último de origin, se fusionará en el {target} local y se hará push a origin/{target}.",
    "fr": "Le dernier état d'origin sera récupéré, fusionné dans le {target} local, puis poussé vers origin/{target}.",
    "zh": "会先取入 origin 的最新内容，再合并到本地的 {target}，并 push 到 origin/{target}。"
  },
  "ローカルの {target} にだけマージします（origin には push しません）。": {
    "en": "Merge only into local {target} (do not push to origin).",
    "es": "Se fusiona solo en el {target} local (no se hace push a origin).",
    "fr": "Fusion seulement dans le {target} local (pas de push vers origin).",
    "zh": "只合并到本地的 {target}（不 push 到 origin）。"
  },
  "マージしたあと、worktree とブランチ {branch} を削除して「完了」にします。": {
    "en": "After the merge, the worktree and branch {branch} are deleted and the task is marked complete.",
    "es": "Después de fusionar, se eliminan el worktree y la rama {branch} y la tarea se marca como completada.",
    "fr": "Après la fusion, le worktree et la branche {branch} sont supprimés et la tâche est marquée terminée.",
    "zh": "合并后，会删除 worktree 和分支 {branch}，并把任务标为完成。"
  },
  "{target} にマージして push しています…": {
    "en": "Merging into {target} and pushing…",
    "es": "Fusionando en {target} y haciendo push…",
    "fr": "Fusion dans {target} et push…",
    "zh": "正在合并到 {target} 并 push…"
  },
  "{target} にマージしています…": {
    "en": "Merging into {target}…",
    "es": "Fusionando en {target}…",
    "fr": "Fusion dans {target}…",
    "zh": "正在合并到 {target}…"
  },
  "{target} とコンフリクトしたので、マージを中止しました。詳細画面から解消できます": {
    "en": "The merge was aborted because it conflicted with {target}. You can resolve it from the detail screen",
    "es": "La fusión se canceló porque hubo un conflicto con {target}. Puedes resolverlo en la pantalla de detalle",
    "fr": "La fusion a été annulée à cause d'un conflit avec {target}. Vous pouvez le résoudre depuis l'écran de détail",
    "zh": "与 {target} 发生冲突，已中止合并。可以在详情页解决"
  },
  "{target} にマージして origin/{target} に push しました": {
    "en": "Merged into {target} and pushed to origin/{target}",
    "es": "Fusionado en {target} y enviado a origin/{target}",
    "fr": "Fusionné dans {target} et poussé vers origin/{target}",
    "zh": "已合并到 {target} 并 push 到 origin/{target}"
  },
  "{target} にマージしました": {
    "en": "Merged into {target}",
    "es": "Fusionado en {target}",
    "fr": "Fusionné dans {target}",
    "zh": "已合并到 {target}"
  },
  "「{title}」のブランチ {branch} を origin に push して、開いている PR（{url}）を更新します。": {
    "en": "The branch {branch} of “{title}” will be pushed to origin, and the open PR ({url}) will be updated.",
    "es": "La rama {branch} de «{title}» se enviará a origin y se actualizará el PR abierto ({url}).",
    "fr": "La branche {branch} de « {title} » sera poussée vers origin, et la PR ouverte ({url}) sera mise à jour.",
    "zh": "将把“{title}”的分支 {branch} push 到 origin，并更新已打开的 PR（{url}）。"
  },
  "「{title}」のブランチ {branch} を origin に push して、GitHub にプルリクエストを作ります（gh を使います）。": {
    "en": "The branch {branch} of “{title}” will be pushed to origin, and a pull request will be created on GitHub (using gh).",
    "es": "La rama {branch} de «{title}» se enviará a origin y se creará un pull request en GitHub (con gh).",
    "fr": "La branche {branch} de « {title} » sera poussée vers origin, et une pull request sera créée sur GitHub (avec gh).",
    "zh": "将把“{title}”的分支 {branch} push 到 origin，并用 gh 在 GitHub 上创建拉取请求。"
  },
  "「{title}」のブランチ <code>{branch}</code> を、選んだブランチにマージします（--no-ff）。": {
    "en": "The branch <code>{branch}</code> of “{title}” will be merged into the branch you choose (--no-ff).",
    "es": "La rama <code>{branch}</code> de «{title}» se fusionará en la rama que elijas (--no-ff).",
    "fr": "La branche <code>{branch}</code> de « {title} » sera fusionnée dans la branche choisie (--no-ff).",
    "zh": "将把“{title}”的分支 <code>{branch}</code> 合并到所选分支（--no-ff）。"
  },
  "PR を作ったあと、ローカルの worktree とブランチ {branch} を削除して「完了」にします（origin のブランチと PR は残ります）。": {
    "en": "After the PR is created, the local worktree and branch {branch} are deleted and the task is marked complete (the branch on origin and the PR remain).",
    "es": "Después de crear el PR, se eliminan el worktree local y la rama {branch} y la tarea se marca como completada (la rama en origin y el PR se quedan).",
    "fr": "Après la création de la PR, le worktree local et la branche {branch} sont supprimés et la tâche est marquée terminée (la branche sur origin et la PR restent).",
    "zh": "创建 PR 后，会删除本地的 worktree 和分支 {branch}，并把任务标为完成（origin 上的分支和 PR 会保留）。"
  },
  "{name} のタブに切り替えました": {
    "en": "Switched to the {name} tab",
    "es": "Cambiado a la pestaña {name}",
    "fr": "Basculé vers l'onglet {name}",
    "zh": "已切换到 {name} 标签"
  },
  "{name} を開きました": {
    "en": "Opened {name}",
    "es": "Se abrió {name}",
    "fr": "{name} ouvert",
    "zh": "已打开 {name}"
  },
  "選んだリポジトリを新しいタブで開きます（タブは {n} つまで）。": {
    "en": "The repository you choose opens in a new tab (up to {n} tabs).",
    "es": "El repositorio que elijas se abre en una pestaña nueva (hasta {n} pestañas).",
    "fr": "Le dépôt choisi s'ouvre dans un nouvel onglet ({n} onglets au plus).",
    "zh": "所选仓库会在新标签中打开（最多 {n} 个标签）。"
  },
  "選んだリポジトリで、今のタブ（{name}）を置き換えます。": {
    "en": "The repository you choose replaces the current tab ({name}).",
    "es": "El repositorio que elijas sustituye la pestaña actual ({name}).",
    "fr": "Le dépôt choisi remplace l'onglet actuel ({name}).",
    "zh": "所选仓库会替换当前标签（{name}）。"
  },
  "ホスト（{host}）で最近開いたリポジトリ": {
    "en": "Repositories opened recently on the host ({host})",
    "es": "Repositorios abiertos hace poco en el host ({host})",
    "fr": "Dépôts ouverts récemment sur l'hôte ({host})",
    "zh": "在主机（{host}）上最近打开的仓库"
  },
  "ホスト（{host}）": {
    "en": "Host ({host})",
    "es": "Host ({host})",
    "fr": "Hôte ({host})",
    "zh": "主机（{host}）"
  },
  "このマシン": {
    "en": "This machine",
    "es": "Esta máquina",
    "fr": "Cette machine",
    "zh": "此电脑"
  },
  "接続先（{host}）のフォルダを選びます。エージェントはホストのそのフォルダで動きます。": {
    "en": "Choose a folder on the connected machine ({host}). Agents run in that folder on the host.",
    "es": "Elige una carpeta de la máquina conectada ({host}). Los agentes se ejecutan en esa carpeta del host.",
    "fr": "Choisissez un dossier de la machine connectée ({host}). Les agents s'exécutent dans ce dossier de l'hôte.",
    "zh": "选择连接的主机（{host}）上的文件夹。代理在主机的该文件夹中运行。"
  },
  "{host} のフォルダを、この画面で辿って選びます": {
    "en": "Browse folders on {host} in this screen",
    "es": "Recorre las carpetas de {host} en esta pantalla",
    "fr": "Parcourez les dossiers de {host} dans cet écran",
    "zh": "在此画面中浏览 {host} 的文件夹"
  },
  "{name} のフォルダを開く": {
    "en": "Open a folder in {name}",
    "es": "Abrir una carpeta de {name}",
    "fr": "Ouvrir un dossier de {name}",
    "zh": "打开 {name} 中的文件夹"
  },
  "\\\\wsl.localhost\\{name}\\home\\… から開きます": {
    "en": "Opens from \\\\wsl.localhost\\{name}\\home\\…",
    "es": "Se abre desde \\\\wsl.localhost\\{name}\\home\\…",
    "fr": "S'ouvre depuis \\\\wsl.localhost\\{name}\\home\\…",
    "zh": "从 \\\\wsl.localhost\\{name}\\home\\… 打开"
  },
  "パスを入れて Enter で移動します": {
    "en": "Enter a path and press Enter to go there",
    "es": "Escribe una ruta y pulsa Enter para ir",
    "fr": "Saisissez un chemin et appuyez sur Entrée pour y aller",
    "zh": "输入路径后按 Enter 转到"
  },
  "接続先（{host}）のフォルダです。開きたいフォルダまで移動して「このフォルダを開く」を押すか、一覧の git リポジトリの「開く」を押します。git で管理していないフォルダも開けます（worktree を作らず、そのフォルダでタスクを動かします）。": {
    "en": "These are folders on the connected machine ({host}). Go to the folder you want and press Open this folder, or press Open on a git repository in the list. A folder not managed by git can be opened too (the task runs in that folder, without a worktree).",
    "es": "Estas son carpetas de la máquina conectada ({host}). Ve a la carpeta que quieras y pulsa Abrir esta carpeta, o pulsa Abrir en un repositorio git de la lista. También se puede abrir una carpeta no gestionada con git (la tarea se ejecuta en esa carpeta, sin worktree).",
    "fr": "Ce sont les dossiers de la machine connectée ({host}). Allez au dossier voulu et appuyez sur Ouvrir ce dossier, ou sur Ouvrir pour un dépôt git de la liste. Un dossier non géré par git peut aussi être ouvert (la tâche s'exécute dans ce dossier, sans worktree).",
    "zh": "这是所连接主机（{host}）上的文件夹。移动到想打开的文件夹后按“打开此文件夹”，或按列表中 git 仓库的“打开”。不用 git 管理的文件夹也可以打开（不创建 worktree，任务直接在该文件夹中运行）。"
  },
  "https://github.com/owner/repo または owner/repo": {
    "en": "https://github.com/owner/repo or owner/repo",
    "es": "https://github.com/owner/repo u owner/repo",
    "fr": "https://github.com/owner/repo ou owner/repo",
    "zh": "https://github.com/owner/repo 或 owner/repo"
  },
  "フォルダ名": {
    "en": "Folder name",
    "es": "Nombre de la carpeta",
    "fr": "Nom du dossier",
    "zh": "文件夹名"
  },
  "作るフォルダ: {path}": {
    "en": "Folder to create: {path}",
    "es": "Carpeta que se creará: {path}",
    "fr": "Dossier à créer : {path}",
    "zh": "将创建的文件夹：{path}"
  },
  "{n}分前": {
    "en": "{n} min ago",
    "es": "hace {n} min",
    "fr": "il y a {n} min",
    "zh": "{n} 分钟前"
  },
  "{n}時間前": {
    "en": "{n} hr ago",
    "es": "hace {n} h",
    "fr": "il y a {n} h",
    "zh": "{n} 小时前"
  },
  "この通知を消す": {
    "en": "Dismiss this notification",
    "es": "Descartar este aviso",
    "fr": "Effacer cette notification",
    "zh": "清除此通知"
  },
  "{name}（WSL）": {
    "en": "{name} (WSL)",
    "es": "{name} (WSL)",
    "fr": "{name} (WSL)",
    "zh": "{name}（WSL）"
  },
  "{wsl}（WSL）の中に git が見つかりません。{wsl} のターミナルで sudo apt install git を実行してください。": {
    "en": "git was not found inside {wsl} (WSL). Run sudo apt install git in a {wsl} terminal.",
    "es": "No se encuentra git dentro de {wsl} (WSL). Ejecuta sudo apt install git en una terminal de {wsl}.",
    "fr": "git est introuvable dans {wsl} (WSL). Exécutez sudo apt install git dans un terminal {wsl}.",
    "zh": "在 {wsl}（WSL）中找不到 git。请在 {wsl} 的终端中运行 sudo apt install git。"
  },
  "{wsl}（WSL）の中に {agent} が見つかりません。{wsl} のターミナルで {label} をインストールしてログインしてください（このリポジトリのタスクは {wsl} の中で動きます）。": {
    "en": "{agent} was not found inside {wsl} (WSL). Install {label} in a {wsl} terminal and sign in (tasks for this repository run inside {wsl}).",
    "es": "No se encuentra {agent} dentro de {wsl} (WSL). Instala {label} en una terminal de {wsl} e inicia sesión (las tareas de este repositorio se ejecutan dentro de {wsl}).",
    "fr": "{agent} est introuvable dans {wsl} (WSL). Installez {label} dans un terminal {wsl} et connectez-vous (les tâches de ce dépôt s'exécutent dans {wsl}).",
    "zh": "在 {wsl}（WSL）中找不到 {agent}。请在 {wsl} 的终端中安装 {label} 并登录（此仓库的任务在 {wsl} 中运行）。"
  },
  "git が見つかりません。Git for Windows（https://git-scm.com/）をインストールしてから、アプリを再起動してください。": {
    "en": "git was not found. Install Git for Windows (https://git-scm.com/), then restart the app.",
    "es": "No se encuentra git. Instala Git for Windows (https://git-scm.com/) y reinicia la aplicación.",
    "fr": "git est introuvable. Installez Git for Windows (https://git-scm.com/), puis redémarrez l'application.",
    "zh": "找不到 git。请安装 Git for Windows（https://git-scm.com/）后重新启动应用。"
  },
  "git が見つかりません。ターミナルで xcode-select --install を実行するか Homebrew で git をインストールしてから、アプリを再起動してください。": {
    "en": "git was not found. Run xcode-select --install in a terminal, or install git with Homebrew, then restart the app.",
    "es": "No se encuentra git. Ejecuta xcode-select --install en la terminal, o instala git con Homebrew, y reinicia la aplicación.",
    "fr": "git est introuvable. Exécutez xcode-select --install dans un terminal, ou installez git avec Homebrew, puis redémarrez l'application.",
    "zh": "找不到 git。请在终端运行 xcode-select --install，或用 Homebrew 安装 git，然后重新启动应用。"
  },
  "git が見つかりません。git をインストールしてから、アプリを再起動してください。": {
    "en": "git was not found. Install git, then restart the app.",
    "es": "No se encuentra git. Instala git y reinicia la aplicación.",
    "fr": "git est introuvable. Installez git, puis redémarrez l'application.",
    "zh": "找不到 git。请安装 git 后重新启动应用。"
  },
  "{agent} コマンドが見つかりません。{label} をインストールしてログインするか、「設定」で {agent} のフルパスを指定してください（ターミナルで which {agent}、Windows なら where {agent} で調べられます）。使わないなら、「設定」の「使うエージェント」でチェックを外してください。": {
    "en": "The {agent} command was not found. Install {label} and sign in, or set the full path of {agent} in Settings (find it with which {agent} in a terminal, or where {agent} on Windows). If you do not use it, uncheck it under Agents to use in Settings.",
    "es": "No se encuentra el comando {agent}. Instala {label} e inicia sesión, o indica la ruta completa de {agent} en Ajustes (se averigua con which {agent} en la terminal, o where {agent} en Windows). Si no lo usas, desmarca la casilla en Agentes que usar, en Ajustes.",
    "fr": "La commande {agent} est introuvable. Installez {label} et connectez-vous, ou indiquez le chemin complet de {agent} dans Réglages (which {agent} dans un terminal, ou where {agent} sous Windows). Si vous ne l'utilisez pas, décochez-le dans Agents à utiliser, dans Réglages.",
    "zh": "找不到 {agent} 命令。请安装 {label} 并登录，或在“设置”中指定 {agent} 的完整路径（在终端用 which {agent}，Windows 用 where {agent} 查看）。若不使用，请在“设置”的“使用的代理”中取消勾选。"
  }
});
