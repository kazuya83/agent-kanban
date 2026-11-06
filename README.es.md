<div align="center">

<img src="docs/images/icon.png" alt="" width="96" />

# Worktree Kanban

<strong>Ejecuta agentes de programación con IA en paralelo y contrólalos desde otro PC.</strong><br />
Mac y Windows pueden manejarse el uno al otro a distancia.

[Sitio web](https://kazuya83.github.io/worktree-kanban/) · [Descargar](https://github.com/kazuya83/worktree-kanban/releases/latest)

[![Release](https://img.shields.io/github/v/release/kazuya83/worktree-kanban?label=release&color=3b5bfd)](https://github.com/kazuya83/worktree-kanban/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Mac%20%7C%20Windows%20%7C%20Linux-52525B)](https://github.com/kazuya83/worktree-kanban/releases/latest)
[![Remote control](https://img.shields.io/badge/remote%20control-Mac%20%E2%87%84%20Windows-0891B2)](docs/images/en/rc-client.png)
[![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Gemini%20%7C%20Cursor-7C3AED)](https://github.com/kazuya83/worktree-kanban#readme)
[![License](https://img.shields.io/badge/license-FSL--1.1--ALv2-52525B)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [简体中文](README.zh-CN.md)

</div>

<div align="center">

![Demostración: crear una tarea, ver las tarjetas en paralelo, aprobar, revisar el diff, fusionar y manejar el tablero a distancia](docs/images/es/demo.gif)

</div>

Aplicación de escritorio (Electron, Mac / Windows / Linux) que ejecuta en paralelo las CLI de agentes de programación con IA (Claude Code / Codex CLI / Gemini CLI / Cursor CLI), cada tarea en su propio git worktree, y las gestiona en un tablero kanban. **No solo ejecuta tareas dentro de un repositorio: también puede ejecutar a la vez tareas de varios repositorios.**

![Tablero: columnas Por hacer, En ejecución, Revisión y Hecho. Las tarjetas en ejecución muestran pregunta, espera de aprobación y en curso](docs/images/es/board.png)

## ¿Por qué Worktree Kanban?

- **Control remoto Mac ⇄ Windows** — ejecuta los agentes en un PC y maneja el mismo tablero desde el otro: aprueba, responde preguntas, envía instrucciones y fusiona.
- **Una tarea, un worktree** — cada tarea tiene su propio worktree de git y su rama, así que no chocan entre sí ni con tu árbol de trabajo.
- **Varios repositorios a la vez** — abre hasta 3 repositorios en pestañas; cambiar de pestaña no detiene nada.
- **Las CLI que ya usas** — Claude Code, Codex CLI, Gemini CLI y Cursor CLI, con tu sesión y tu configuración actuales.
- **Tú decides** — revisa el diff antes de fusionar o abrir un PR. Con Claude Code, también apruebas las acciones en la tarjeta.
- **Todo en local** — el estado del tablero se queda en tu máquina. No hay un servidor externo.

## Cómo funciona

```mermaid
flowchart LR
    C["PC cliente"] -- "Túnel SSH" --> B
    subgraph H["PC host"]
        B["Tablero"] --> W1["worktree y rama 1"] --> A1["CLI del agente"]
        B --> W2["worktree y rama 2"] --> A2["CLI del agente"]
        A1 --> R["Tu repositorio"]
        A2 --> R
    end
    R -- "Fusión / PR" --> O(("main"))
```

- **1 tarea = 1 worktree = 1 rama.** Crea un worktree en `<repo>.worktrees/<id>`, junto al repositorio, y trabaja en una rama `agent/<resumen>-<id>`. Las tareas no chocan entre sí ni con el árbol de trabajo que tienes abierto
- **El agente es la CLI, arrancada tal cual.** Claude Code se ejecuta con `claude -p --input-format stream-json --output-format stream-json`, y su salida se muestra en la tarjeta como registro. El inicio de sesión, el modelo, `CLAUDE.md` y las skills son los mismos que usas en la terminal
- **La aprobación pasa por `--permission-prompt-tool` de Claude Code.** Solo las acciones que el modo de permisos o `--allowedTools` no autoriza automáticamente aparecen en la tarjeta como espera de aprobación
- **Al terminar, incorporas el trabajo con un merge (`--no-ff`) o creando un PR (`gh`).** Puedes elegir la rama de destino y, después del merge, hacer push a origin
- El estado del tablero se guarda en `board.json`, en la carpeta userData de Electron. No hay un servidor externo

En Codex / Gemini / Cursor, por los límites de la CLI, no están disponibles la aprobación en la tarjeta, las preguntas de opción múltiple, btw ni el coste (más detalles en [docs/agents.md](docs/agents.md) (English)).

## Funciones principales

### Operar desde otro PC (RC)

Puedes manejar el tablero del PC que ejecuta los agentes (el host) desde Worktree Kanban en otro PC (el cliente). Tanto Mac como Windows pueden ser el host, y cualquiera de los dos puede ser el cliente. En el cliente puedes aprobar, responder preguntas, enviar instrucciones adicionales, hacer merge, etc., igual que en la pantalla del host.

![Conectarse desde otro PC y aprobar en el tablero del host](docs/images/es/feature-remote.gif)

- La aplicación del host solo escucha en `127.0.0.1`. La del cliente conecta con un túnel `ssh -N -L`, así que en el host solo hace falta un servidor SSH. Para conectar desde fuera, usa Tailscale u otra red similar
- SSH entra con una clave. En los «Ajustes de RC» del cliente, crea una clave ed25519 (`~/.ssh/agent-kanban_ed25519`) y registra la clave pública en los «Ajustes de RC» del host
- La primera vez se empareja con un código de 6 dígitos que aparece en el host. Después, un token guardado vuelve a conectar con el destino anterior

![Ajustes de RC del cliente (destino SSH y clave)](docs/images/es/rc-settings.png)

![Manejo del tablero del host desde el cliente (arriba se lee «Control remoto → SSH 100.101.102.103»)](docs/images/es/rc-client.png)

Los pasos, y cómo arreglar una conexión que falla, están en [docs/remote.md](docs/remote.md) (English).

Además: cambiar el estado (columna) de una tarjeta arrastrándola, mensajes a un agente en ejecución (btw), adjuntar imágenes y archivos, competición (varios agentes resuelven la misma tarea), y repositorios de WSL en Windows. El uso está resumido en [docs/usage.md](docs/usage.md) (English).

### Pipeline: describe un flujo en lenguaje natural y ejecuta tareas con él
Escribe el flujo que quieres en lenguaje natural, por ejemplo «implementar con Codex, revisar con Claude y volver a la implementación si hay cambios que hacer», y el agente construye el diagrama de flujo. Elige ese Pipeline al crear una tarea y los agentes se pasarán el trabajo paso a paso, siguiendo sus ramas y bucles. También puedes editar el diagrama a mano.

![Escribir un flujo en lenguaje natural, elegirlo para una tarea nueva y ver cómo avanzan los pasos y vuelven atrás tras una revisión](docs/images/es/feature-pipeline.gif)

Los detalles están en [docs/agents.md](docs/agents.md) (English).

### Subtareas
Cuando una tarea es grande, el agente puede proponer dividirla en subtareas. Salen de la rama padre, avanzan en paralelo o en orden y se fusionan a medida que terminan.

![Aceptar la propuesta de dividir una tarea y ver cómo las subtareas avanzan y se fusionan](docs/images/es/feature-subtasks.gif)

### Ejecutar varios repositorios en paralelo

Los repositorios se abren en pestañas (hasta 3). Cambiar de pestaña no detiene las tareas de los otros repositorios. Una pestaña que no está seleccionada muestra **cuántas tareas están en marcha** (azul) y **cuántas esperan tu respuesta** (aprobación, una pregunta, etc., en naranja), así que las pestañas bastan para ver qué repositorio te necesita. El límite de tareas simultáneas (el ajuste de cuántas ejecutar a la vez) se comparte entre todos los repositorios.

![Cambiar de pestaña de repositorio mientras las tareas de las demás siguen en marcha](docs/images/es/feature-repos.gif)

![Tres repositorios abiertos en pestañas. Las pestañas inactivas muestran cuántas tareas están en marcha y cuántas esperan tu respuesta](docs/images/es/repo-tabs.png)

El «+» de la barra de pestañas, o pulsar la pestaña abierta, permite elegir entre los repositorios abiertos hace poco. Desde ahí también se puede clonar desde una URL o crear un repositorio nuevo.

Puedes abrir una carpeta que no es un repositorio git (producción de vídeo y otro trabajo que no es código). En ese caso la tarea se ejecuta directamente en la carpeta, sin crear un worktree, y se cierra con «Marcar como hecha» (más detalles en [docs/usage.md](docs/usage.md) (English)).

![Diálogo para elegir repositorio (recientes y los que están abiertos en pestañas)](docs/images/es/repo-switch.png)

### Aprobación

Cuando una acción necesita permiso, puedes leer el comando y la entrada completos en la tarjeta y en el panel de detalle, y luego elegir permitir, rechazar o permitir siempre en esta tarea. Al rechazar, puedes devolver un motivo al agente.

![Leer el comando completo y aprobarlo](docs/images/es/feature-approval.gif)

<details>
<summary>Ver pantalla</summary>

![Tarjeta en espera de aprobación y panel de detalle](docs/images/es/detail-permission.png)

</details>

### Crear tareas desde GitHub Issues

En la pestaña «Crear desde un GitHub Issue» de «Nueva tarea», escribe números (`21, 22, 24`, etc.). Construye las instrucciones a partir del título, el cuerpo y los comentarios del Issue, y crea una tarjeta por Issue. La rama se llama `agent/issue-21-…`, y el cuerpo del PR incluye `Closes #21`. Usa `gh`.

![Introducir números de Issue para crear una tarjeta por Issue](docs/images/es/feature-issue.gif)

<details>
<summary>Ver pantalla</summary>

![Diálogo para crear tareas desde Issues](docs/images/es/issue-dialog.png)

</details>

### Preguntas del agente

Cuando Claude Code pregunta con `AskUserQuestion`, la tarjeta pasa a ser una pregunta y aparece un formulario de respuesta. Se admiten la selección múltiple y el texto libre (Otro).

![Responder a una pregunta del agente eligiendo una opción](docs/images/es/feature-question.gif)

<details>
<summary>Ver pantalla</summary>

![Formulario de respuesta a una pregunta](docs/images/es/question.png)

</details>

### worktree y diff

La pestaña «worktree» muestra los commits de la rama, los cambios sin commit, la relación con la base y los otros worktrees del mismo repositorio. En la pestaña «diff» eliges los archivos cambiados en un árbol agrupado por carpeta y ves el diff de cada archivo.

![Revisar el diff y fusionar](docs/images/es/feature-merge.gif)

<details>
<summary>Ver pantalla</summary>

![Pestaña worktree](docs/images/es/worktree.png)

![Pestaña diff](docs/images/es/diff.png)

</details>

### Conversación

En «Conversación» puedes preguntar al agente sobre el repositorio sin crear una tarea (worktree). Las respuestas se muestran en Markdown. Cuando quieras que empiece a trabajar, «Convertir en tarea» continúa esa conversación como tarea.

![Preguntar sobre el código en una conversación y convertirla en tarea](docs/images/es/feature-chat.gif)

<details>
<summary>Ver pantalla</summary>

![Conversación](docs/images/es/chat.png)

</details>

### Notificaciones

La espera de aprobación, las preguntas, la espera de respuesta, la espera de revisión y la finalización se acumulan en el icono de la campana, arriba a la derecha, y también sale una notificación de escritorio. Al pulsar una notificación se abre esa tarea.

![Abrir una notificación para ir a la tarjeta que te necesita](docs/images/es/feature-notifications.gif)

<details>
<summary>Ver pantalla</summary>

![Notificaciones](docs/images/es/notifications.png)

</details>

### Resolver conflictos

Si un merge entra en conflicto, la tarjeta pasa a ser un conflicto. Después de incorporar la rama base en la rama de la tarea, puedes pedir al agente que lo resuelva o corregirlo tú en un editor. En ambos casos, la rama base no cambia hasta que hagas el merge.

![Pedir al agente que resuelva un conflicto y fusionar](docs/images/es/feature-conflict.gif)

<details>
<summary>Ver pantalla</summary>

![Resolución de un conflicto](docs/images/es/conflict.png)

</details>

### Skills y conversaciones anteriores

Al crear una tarea puedes elegir una skill de Claude Code (se pasa como `/nombre-de-la-skill`). También puedes elegir una conversación anterior de Claude Code (sesión) y continuar desde ahí.

![Elegir una skill y una conversación anterior para una tarea nueva](docs/images/es/feature-skills.gif)

<details>
<summary>Ver pantalla</summary>

![Tarea nueva (con una skill y una conversación elegidas)](docs/images/es/new-task.png)

</details>

### Programador de tareas

Desde el menú de la barra superior, cambia a «Programador de tareas» para gestionar, en tarjetas, programaciones que crean y ejecutan una tarea en un momento dado (una vez, cada hora, cada día, cada semana o cada mes). Puedes registrar una tarea del kanban como programación, y también crear una tarea desde una programación en el momento. Las programaciones solo se ejecutan mientras la aplicación está abierta (más detalles en [docs/usage.md](docs/usage.md) (English)).

![Registrar una revisión diaria de dependencias, ejecutarla ahora y ver el resultado en el tablero](docs/images/es/feature-scheduler.gif)

## Requisitos

- git
- La CLI del agente que uses (una de Claude Code / Codex CLI / Gemini CLI / Cursor CLI), con la sesión ya iniciada
- `gh`, si usas Issues y PRs de GitHub (también se puede instalar desde la aplicación)

## Instalación

**Mac / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

Los mismos comandos actualizan a la última versión. También se puede actualizar desde la aplicación: «Ajustes» → «Actualización de la aplicación» → «Actualizar a la nueva versión». Si marcas «Actualizar automáticamente cuando salga una versión nueva», se sustituye y se vuelve a abrir cuando no hay ninguna tarea en marcha. Para fijar una versión, desinstalar, instalar desde un archivo y el aviso del primer arranque, consulta [docs/install.md](docs/install.md) (English).

## Uso

1. En «Elegir repositorio», elige el repositorio git en el que trabajar (también puedes clonar desde una URL o crear uno nuevo)
2. En «Nueva tarea», escribe las instrucciones y créala
3. Cuando quede en espera de aprobación, permítela en la tarjeta
4. Cuando pase a la columna Revisión, comprueba el diff y pulsa «Merge» o «Crear PR»

## Documentación

| Documento | Contenido |
| --- | --- |
| [Pantalla y uso](docs/usage.md) (English) | Uso de cada función: aprobación, preguntas, comprobación de la especificación, programador de tareas, skills, conversación, btw, merge / PR, estado de los Issues, notificaciones, conflictos y más |
| [Agentes y orquestación](docs/agents.md) (English) | Diferencias entre Claude Code / Codex / Gemini / Cursor, Pipeline y competición |
| [Ajustes](docs/settings.md) (English) | La pantalla de ajustes que se abre desde el menú de la barra superior, y sus apartados |
| [Control remoto](docs/remote.md) (English) | Cómo manejar el tablero desde otro PC por un túnel SSH, y cómo arreglar una conexión que falla |
| [Instalación](docs/install.md) (English) | Instalación, actualización, desinstalación y uso de un repositorio de WSL en Windows |
| [Para desarrolladores](docs/development.md) (English) | Ejecutar desde el código, compilar, publicar, cómo está hecha la aplicación y las pruebas |

## Licencia

Publicado bajo la [Functional Source License 1.1 (FSL-1.1-ALv2)](LICENSE). Puedes usarlo, modificarlo y redistribuirlo para cualquier fin, salvo un producto o servicio comercial competidor. Cada versión pasa a estar disponible bajo la Apache License 2.0 dos años después de su publicación.
