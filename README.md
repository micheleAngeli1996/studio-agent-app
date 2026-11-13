# Studio Agent

App desktop per Windows che fa da **console di regia** per un team di agenti [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) dedicati alla produzione musicale con Cubase 15 Pro e Dorico 6 Pro: armonia, orchestrazione, tracking, mix, mastering.

L'app non contiene gli agenti: lavora sulla cartella **`studio-agent`** (con `.claude/agents`, `songs`, `tools`, `docs`), che si sceglie al primo avvio.

## Installazione
1. Scarica `Studio-Agent-Setup-<versione>.exe` dall'ultima [Release](../../releases/latest) e avvialo.
   L'installer non è firmato: Windows SmartScreen può mostrare "PC protetto da Windows" → *Ulteriori informazioni* → *Esegui comunque*.
2. Al primo avvio scegli la cartella `studio-agent`.
3. Le versioni successive si installano da sole: l'app controlla le Releases all'avvio e ogni 6 ore, e chiede di riavviare quando un aggiornamento è pronto.

### Requisiti sul PC
- **Claude Code** installato e autenticato: il comando `claude` deve funzionare in un terminale.
- **Python** con le librerie degli strumenti: `pip install numpy scipy soundfile pyloudnorm mido pymupdf music21`.

## Funzioni
- **Brani** con la loro memoria (`songs/<Song Title>/SONG.md`): tracce, decisioni, versioni del mix, file prodotti.
- **Catena di produzione**: Armonia → Orchestrazione → Tracking → Mix → Master, più Dorico, Guida Cubase e Produttore. Ogni tappa apre il consulto con il suo agente; le risposte arrivano in tempo reale.
- **Armonia**: griglia degli accordi con i gradi, esportazione MIDI, controllo della condotta a quattro voci.
- **Fonte**: pagine dei manuali (con gli esempi musicali) nel pannello laterale e lettore PDF integrato; le citazioni nelle risposte sono cliccabili.
- **Misure**: trascina un WAV per loudness, true peak, crest, correlazione e bande; registralo come versione del mix.
- **Consumi**: token per agente, brano, fase e richiesta; limiti del piano (5 ore e settimanale).

## Sviluppo
```
npm install
npm run dev        # compila l'interfaccia e apre l'app
npm run dist       # crea l'installer in dist/ (su Windows)
```
- `electron/` processo principale: finestra, avvio di Claude Code (`claude.js`), memoria dei brani (`songs.js`), consumi (`usage.js`), aggiornamenti.
- `ui/` interfaccia Angular (`src/app/app.ts`, `app.html`, `api.ts`, `harmony.ts`, `md.ts`, `src/styles.css`). `npm --prefix ui start` apre un'anteprima nel browser con dati dimostrativi, senza Claude Code.

### Pubblicare una nuova versione
1. Aggiorna `version` in `package.json` e `CHANGELOG.md`.
2. `git commit -am "Release v0.2.1"`, poi `git tag v0.2.1` e `git push --follow-tags`.
3. Il workflow **Release** crea l'installer su Windows e lo pubblica nelle Releases; le app installate si aggiornano da sole.

### Impostazioni
Salvate in `%APPDATA%\Studio Agent\settings.json`: `root` (cartella studio-agent) e, facoltativo, `commands` (`{"claudeCommand": "claude", "pythonCommand": "python"}`) se i comandi hanno un altro nome. Nella stessa cartella: `data\usage.jsonl` (consumi) e `limits.json`.

## Permessi degli agenti avviati dall'app
`Read, Grep, Glob, Edit, Write, WebFetch, WebSearch, Agent` e `Bash` solo per `python tools/*`. Le modifiche ai file sono accettate automaticamente (servono per aggiornare `SONG.md` e scrivere partiture e checklist).
