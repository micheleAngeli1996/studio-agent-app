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
- Facoltativo, per suonare con Komplete Kontrol o altri strumenti: **loopMIDI** con una porta (es. «Studio Agent») attivata come ingresso nello strumento.

## Funzioni
- **Brani** con la loro memoria (`songs/<Song Title>/SONG.md`): tracce, decisioni, versioni del mix, file prodotti.
- **Catena di produzione**: Armonia → Orchestrazione → Tracking → Mix → Master, più Dorico, Guida Cubase e Produttore. Ogni tappa apre il consulto con il suo agente; le risposte arrivano in tempo reale.
- **Armonia**: griglia degli accordi con gradi e cadenze, sezioni (Verse, Chorus…), ascolto con il pianoforte interno o via MIDI (es. Komplete Kontrol tramite una porta loopMIDI), esportazione MIDI, analisi di un MIDI esistente.
- **Sviluppi armonici**: modelli di cadenze, settime, modulazioni e alterazioni cromatiche nella tonalità del brano, ordinati per tipo di composizione, con la pagina del De Ninno.
- **Forma e arrangiamento**: ordine delle sezioni, stile di accompagnamento e melodia di prova; ascolto del brano e MIDI unico con marker per Cubase.
- **Quattro voci ed esercizi**: realizzazione automatica (MusicXML per Dorico), esercizi di basso dato per livello, correzione con raddoppi, sensibile e settima.
- **Fonte**: pagine dei manuali (con gli esempi musicali) nel pannello laterale e lettore PDF integrato; le citazioni nelle risposte sono cliccabili.
- **Misure**: trascina un WAV per loudness, true peak, crest, correlazione e bande; registralo come versione del mix; confronto A/B con un'altra versione o con un brano di riferimento.
- **Consumi**: token per agente, brano, fase e richiesta; limiti del piano (5 ore e settimanale).

## Sviluppo
```
npm install
npm run dev        # compila l'interfaccia e apre l'app
npm run dist       # crea l'installer in dist/ (su Windows)
npm test           # test della logica musicale (gradi, suggerimenti, cadenze, disposizioni)
```
- `electron/` processo principale: finestra, avvio di Claude Code (`claude.js`), memoria dei brani (`songs.js`), consumi (`usage.js`), aggiornamenti.
- `ui/` interfaccia Angular (`src/app/app.ts`, `app.html`, `api.ts`, `harmony.ts`, `roman.ts`, `suggestions.ts`, `piano.ts`, `md.ts`, `src/styles.css`).
- `tests/` test della logica musicale, eseguiti con `npm test` e dalla CI. `npm --prefix ui start` apre un'anteprima nel browser con dati dimostrativi, senza Claude Code.

### Pubblicare una nuova versione
1. Aggiorna `version` in `package.json` e `CHANGELOG.md`.
2. `git commit -am "Release v0.5.1"`, poi `git tag v0.5.1` e `git push --follow-tags`.
3. Il workflow **Release** crea l'installer su Windows e lo pubblica nelle Releases; le app installate si aggiornano da sole.

### Impostazioni
Salvate in `%APPDATA%\Studio Agent\settings.json`: `root` (cartella studio-agent) e, facoltativo, `commands` (`{"claudeCommand": "claude", "pythonCommand": "python"}`) se i comandi hanno un altro nome. Nella stessa cartella: `data\usage.jsonl` (consumi) e `limits.json`.

## Permessi degli agenti avviati dall'app
`Read, Grep, Glob, Edit, Write, WebFetch, WebSearch, Agent` e `Bash` solo per `python tools/*`. Le modifiche ai file sono accettate automaticamente (servono per aggiornare `SONG.md` e scrivere partiture e checklist).
