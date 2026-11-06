[English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [简体中文](README.zh-CN.md)

# Agent Kanban

Aplicación de escritorio (Electron, Mac / Windows / Linux) que ejecuta en paralelo las CLI de agentes de programación con IA (Claude Code / Codex CLI / Gemini CLI / Cursor CLI), cada tarea en su propio git worktree, y las gestiona en un tablero kanban. **No solo mueve tareas dentro de un repositorio: también puede mover a la vez tareas de varios repositorios.**

![Tablero: columnas Por hacer, En ejecución, Revisión y Hecho. Las tarjetas en ejecución muestran pregunta, espera de aprobación y en curso](docs/board.png)

## Cómo funciona

- **1 tarea = 1 worktree = 1 rama.** Crea un worktree en `<repo>.worktrees/<id>`, junto al repositorio, y trabaja en una rama `agent/<resumen>-<id>`. Las tareas no chocan entre sí ni con el árbol de trabajo que tienes abierto
- **El agente es la CLI, arrancada tal cual.** Claude Code se ejecuta con `claude -p --input-format stream-json --output-format stream-json`, y su salida se muestra en la tarjeta como registro. El inicio de sesión, el modelo, `CLAUDE.md` y las skills son los mismos que usas en la terminal
- **La aprobación pasa por `--permission-prompt-tool` de Claude Code.** Solo las acciones que el modo de permisos o `--allowedTools` no autoriza solo aparecen en la tarjeta como espera de aprobación
- **Al terminar, incorporas el trabajo con un merge (`--no-ff`) o creando un PR (`gh`).** Puedes elegir la rama de destino y, después del merge, hacer push a origin
- El estado del tablero se guarda en `board.json`, en la carpeta userData de Electron. No hay un servidor externo

En Codex / Gemini / Cursor, por los límites de la CLI, no están disponibles la aprobación en la tarjeta, las preguntas de opción múltiple, btw ni el coste (más detalles en [docs/agents.md](docs/agents.md) (Japanese)).

## Funciones principales

### Ejecutar varios repositorios en paralelo

Los repositorios se abren en pestañas (hasta 3). Cambiar de pestaña no detiene las tareas de los otros repositorios. Una pestaña que no está seleccionada muestra **cuántas tareas están en marcha** (azul) y **cuántas esperan tu respuesta** (aprobación, una pregunta, etc., en naranja), así que las pestañas bastan para ver qué repositorio te necesita. El límite de tareas simultáneas (el ajuste de cuántas ejecutar a la vez) se comparte entre todos los repositorios.

![Tres repositorios abiertos en pestañas. Las pestañas inactivas muestran cuántas tareas están en marcha y cuántas esperan tu respuesta](docs/repo-tabs.png)

El «+» de la barra de pestañas, o pulsar la pestaña abierta, permite elegir entre los repositorios abiertos hace poco. Desde ahí también se puede clonar desde una URL o crear un repositorio nuevo.

Puedes abrir una carpeta que no es un repositorio git (producción de vídeo y otro trabajo que no es código). En ese caso la tarea se ejecuta directamente en la carpeta, sin crear un worktree, y se cierra con «Marcar como hecha» (más detalles en [docs/usage.md](docs/usage.md) (Japanese)).

![Diálogo para elegir repositorio (recientes y los que están abiertos en pestañas)](docs/repo-switch.png)

### Aprobación

Cuando una acción necesita permiso, puedes leer el comando y la entrada completos en la tarjeta y en el panel de detalle, y luego elegir permitir, rechazar o permitir siempre en esta tarea. Al rechazar, puedes devolver un motivo al agente.

![Tarjeta en espera de aprobación y panel de detalle](docs/detail-permission.png)

### Crear tareas desde GitHub Issues

En la pestaña «Crear desde un GitHub Issue» de «Nueva tarea», escribe números (`21, 22, 24`, etc.). Construye las instrucciones a partir del título, el cuerpo y los comentarios del Issue, y crea una tarjeta por Issue. La rama se llama `agent/issue-21-…`, y el cuerpo del PR incluye `Closes #21`. Usa `gh`.

![Diálogo para crear tareas desde Issues](docs/issue-dialog.png)

### Preguntas del agente

Cuando Claude Code pregunta con `AskUserQuestion`, la tarjeta pasa a ser una pregunta y aparece un formulario de respuesta. Se admiten la selección múltiple y el texto libre (Otro).

![Formulario de respuesta a una pregunta](docs/question.png)

### worktree y diff

La pestaña «worktree» muestra los commits de la rama, los cambios sin commit, la relación con la base y los otros worktrees del mismo repositorio. En la pestaña «diff» eliges los archivos cambiados en un árbol agrupado por carpeta y ves el diff de cada archivo.

![Pestaña worktree](docs/worktree.png)

![Pestaña diff](docs/diff.png)

### Conversación

En «Conversación» puedes preguntar al agente sobre el repositorio sin crear una tarea (worktree). Las respuestas se muestran en Markdown. Cuando quieras que empiece a trabajar, «Convertir en tarea» continúa esa conversación como tarea.

![Conversación](docs/chat.png)

### Notificaciones

La espera de aprobación, las preguntas, la espera de respuesta, la espera de revisión y la finalización se acumulan en el icono de la campana, arriba a la derecha, y también sale una notificación de escritorio. Al pulsar una notificación se abre esa tarea.

![Notificaciones](docs/notifications.png)

### Resolver conflictos

Si un merge entra en conflicto, la tarjeta pasa a ser un conflicto. Después de incorporar la rama base en la rama de la tarea, puedes pedir al agente que lo resuelva o corregirlo tú en un editor. En ambos casos, la rama base no cambia hasta que hagas el merge.

![Resolución de un conflicto](docs/conflict.png)

### Skills y conversaciones anteriores

Al crear una tarea puedes elegir una skill de Claude Code (se pasa como `/nombre-de-la-skill`). También puedes elegir una conversación anterior de Claude Code (sesión) y continuar desde ahí.

![Tarea nueva (con una skill y una conversación elegidas)](docs/new-task.png)

### Programador de tareas

Desde el menú de la barra superior, cambia a «Programador de tareas» para gestionar, en tarjetas, programaciones que crean y ejecutan una tarea en un momento dado (una vez, cada hora, cada día, cada semana o cada mes). Puedes registrar una tarea del kanban como programación, y también crear una tarea desde una programación en el momento. Las programaciones solo se ejecutan mientras la aplicación está abierta (más detalles en [docs/usage.md](docs/usage.md) (Japanese)).

### Operar desde otro PC (RC)

Puedes manejar el tablero del PC que ejecuta los agentes (el host) desde Agent Kanban en otro PC (el cliente). Tanto Mac como Windows pueden ser el host, y cualquiera de los dos puede ser el cliente. En el cliente puedes aprobar, responder preguntas, enviar instrucciones adicionales, hacer merge, etc., igual que en la pantalla del host.

- La aplicación del host solo escucha en `127.0.0.1`. La del cliente conecta con un túnel `ssh -N -L`, así que en el host solo hace falta un servidor SSH. Para conectar desde fuera, usa Tailscale u otra red similar
- SSH entra con una clave. En los «Ajustes de RC» del cliente, crea una clave ed25519 (`~/.ssh/agent-kanban_ed25519`) y registra la clave pública en los «Ajustes de RC» del host
- La primera vez se empareja con un código de 6 dígitos que aparece en el host. Después, un token guardado vuelve a conectar con el destino anterior

![Ajustes de RC del cliente (destino SSH y clave)](docs/rc-settings.png)

![Manejo del tablero del host desde el cliente (arriba se lee «Control remoto → SSH 100.101.102.103»)](docs/rc-client.png)

Los pasos, y cómo arreglar una conexión que falla, están en [docs/remote.md](docs/remote.md) (Japanese).

Además: dividir una tarea grande en subtareas que avanzan en paralelo o en orden (salen de la rama padre y se fusionan al terminar; también se puede iniciar una sola subtarea; se admiten los sub-issues de GitHub), cambiar el estado (columna) de una tarjeta arrastrándola, mensajes a un agente en ejecución (btw), adjuntar imágenes y archivos, Pipeline y competición (combinaciones de varios agentes), y repositorios de WSL en Windows. El uso está resumido en [docs/usage.md](docs/usage.md) (Japanese).

## Requisitos

- git
- La CLI del agente que uses (una de Claude Code / Codex CLI / Gemini CLI / Cursor CLI), con la sesión ya iniciada
- `gh`, si usas Issues y PRs de GitHub (también se puede instalar desde la aplicación)

## Instalación

**Mac / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
```

Los mismos comandos actualizan a la última versión. También se puede actualizar desde la aplicación: «Ajustes» → «Actualización de la aplicación» → «Actualizar a la nueva versión». Si marcas «Actualizar solo cuando salga una versión nueva», se sustituye y se vuelve a abrir cuando no hay ninguna tarea en marcha. Para fijar una versión, desinstalar, instalar desde un archivo y el aviso del primer arranque, consulta [docs/install.md](docs/install.md) (Japanese).

## Uso

1. En «Elegir repositorio», elige el repositorio git en el que trabajar (también puedes clonar desde una URL o crear uno nuevo)
2. En «Nueva tarea», escribe las instrucciones y créala
3. Cuando quede en espera de aprobación, permítela en la tarjeta
4. Cuando pase a la columna Revisión, comprueba el diff y pulsa «Merge» o «Crear PR»

## Documentación

| Documento | Contenido |
| --- | --- |
| [Pantalla y uso](docs/usage.md) (Japanese) | Uso de cada función: aprobación, preguntas, comprobación de la especificación, programador de tareas, skills, conversación, btw, merge / PR, estado de los Issues, notificaciones, conflictos y más |
| [Agentes y orquestación](docs/agents.md) (Japanese) | Diferencias entre Claude Code / Codex / Gemini / Cursor, Pipeline y competición |
| [Ajustes](docs/settings.md) (Japanese) | La pantalla de ajustes que se abre desde el menú de la barra superior, y sus apartados |
| [Control remoto](docs/remote.md) (Japanese) | Cómo manejar el tablero desde otro PC por un túnel SSH, y cómo arreglar una conexión que falla |
| [Instalación](docs/install.md) (Japanese) | Instalación, actualización, desinstalación y uso de un repositorio de WSL en Windows |
| [Para desarrolladores](docs/development.md) (Japanese) | Ejecutar desde el código, compilar, publicar, cómo está hecha la aplicación y las pruebas |
