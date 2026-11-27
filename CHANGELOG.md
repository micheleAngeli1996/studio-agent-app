# Changelog

## 0.5.4 — 2026-11-27

### Corretto
- **Uscita MIDI dimenticata**: se all'avvio dell'app loopMIDI non era ancora partito, la porta scelta veniva sostituita per sempre dal pianoforte interno. Ora la scelta resta memorizzata e la porta viene ripresa da sola appena ricompare.
- **Avvisi sull'ascolto via MIDI**: l'app controlla se loopMIDI e Komplete Kontrol sono aperti, lo segnala nella barra della progressione («⚠ uscita MIDI») e nella scheda Ascolto, con i pulsanti «Avvia loopMIDI» e «Apri Komplete Kontrol». Promemoria: Komplete Kontrol non ricarica da solo lo strumento.

## 0.5.3 — 2026-11-27

### Cambiato
- **Pannello della progressione ridisegnato**: non copre più la conversazione. In alto una barra compatta sempre visibile (sezione, ▶ ascolto, accordi cliccabili, BPM e uscita); aperta, mostra quattro schede (Accordi, Ascolto, Quattro voci ed esercizi, Forma e arrangiamento) con contenuto scorrevole. L'altezza si regola trascinando il divisore (o con le frecce, doppio clic per tornare a quella iniziale) e viene ricordata; la conversazione e il campo di scrittura restano sempre visibili.
- Un brano senza progressione principale apre direttamente la prima sezione scritta (es. Verse).

## 0.5.2 — 2026-11-27

### Corretto
- Il menu dei brani si chiude con Esc o con un clic fuori.
- «Forma e arrangiamento»: se il brano non ha ancora una forma salvata, propone tutte le sezioni nell'ordine in cui sono scritte (o la progressione principale).
- Allineamento della casella «Melodia di prova».

## 0.5.1 — 2026-11-27

### Corretto
- **Python giusto per strumenti e agenti**: su Windows il comando `python` può aprire un'installazione senza librerie (es. Python Install Manager 3.14). L'app ora cerca il Python che ha mido, numpy, scipy, music21, soundfile, pyloudnorm e pymupdf, lo usa per gli strumenti e lo mette in testa al PATH degli agenti; se nessuno le ha, mostra il comando `pip install` da eseguire. Versione di Python indicata nel menu dei brani.

## 0.5.0 — 2026-11-27

### Aggiunto
- **Forma e arrangiamento del brano** (Armonia → «Forma e arrangiamento»): ordine delle sezioni (Intro, Verse, Chorus…) salvato in SONG.md come `- Forma: ...`; Intro e Outro senza progressione si ricavano dalle sezioni vicine.
- **Pattern di accompagnamento per stile**: pop, ballata, rock, valzer (3/4), arpeggio, corale; tracce Piano, Electric Bass e Drums con intensità diversa per sezione, rullate e piatti ai cambi di sezione, pedale nelle ballate.
- **Melodia di prova** (Flute, Violin, Oboe…): note dell'accordo sui tempi forti, passaggi sui deboli; la stessa sezione ripetuta ha la stessa melodia.
- **«Ascolta il brano»** nell'app (con batteria sintetizzata nel pianoforte interno) e **«Crea il MIDI del brano»**: un solo MIDI con marker delle sezioni, tempo, metro e armatura, pronto per Cubase (`tools/arrange.py`).
- **Ascolto via MIDI**: canali separati (Piano 1, Electric Bass 2, melodia 3, Drums 10) oppure tutto su un canale; pedale di risonanza ai cambi di accordo; dinamica meno meccanica; «Prova suono», «Aggiorna porte» e scelta automatica della porta loopMIDI «Studio Agent».
- **Esercizi per livello**: triadi e rivolti, settime, modulazioni, alterazioni cromatiche; «Esporta per Dorico» scrive il basso numerato con le voci superiori vuote.
- **Correzione completa a quattro voci**: oltre a quinte e ottave, note estranee, terza o settima mancanti, raddoppi (sensibile, settima, terza), risoluzione di sensibile e settima, con il link alla pagina del De Ninno.
- **Analizza un MIDI**: da un file MIDI alla progressione e alla tonalità stimata (`tools/midi2chords.py`).
- **Confronto A/B nel pannello Misure**: con un'altra versione del mix o con un brano di riferimento; spettri in terzi d'ottava, tabella delle differenze, sintesi e «Chiedi al mixer cosa cambiare».
- **Test automatici** della logica musicale (`npm test`, eseguiti dalla CI).

### Corretto
- Modulazione enarmonica e 7ª diminuita negli esercizi: niente più sensibile al basso che salta.
- Python avviato dall'app in UTF-8 (nomi con lettere accentate nei risultati).

## 0.4.2 — 2026-11-15

### Corretto
- Aggiornamenti: «Riavvia ora» installa in modo silenzioso e riapre l'app, senza la finestra dell'installer da chiudere a mano.
- Il pulsante «Ascolta al pianoforte» / «Ferma» ha larghezza fissa: i controlli accanto non si spostano più durante l'ascolto.

## 0.4.1 — 2026-11-15

### Corretto
- Uscita MIDI: il permesso Web MIDI veniva negato su Windows (Chromium lo chiede come «midiSysex»), quindi le porte non comparivano nel menu «Suono».

## 0.4.0 — 2026-11-15

### Aggiunto
- **Uscita MIDI**: nella sezione Armonia il menu «Suono» manda la progressione a una porta MIDI invece che al pianoforte interno, per suonarla con Komplete Kontrol (The Grandeur, BBCSO Piano Pro) o con qualsiasi altro strumento. Indicazioni sulle porte della tastiera e della UR816.
- **Realizza a quattro voci**: disposizione automatica Soprano, Alto, Tenor, Bass secondo le regole del trattato (`tools/satb.py`), controllata con voice_check e salvata come MusicXML + MIDI in `score/` per Dorico; «Ascolta le voci».
- **Esercizi di basso dato**: basso generato da un modello armonico nella tonalità del brano, con gradi e pagina del De Ninno; controllo delle note estranee all'accordo e delle regole di condotta; «Mostra una soluzione».
- **Cadenze nella griglia**: perfetta, evitata, plagale, sospesa e cadenze perfette su gradi tonicizzati.
- **Punto di inserimento**: un clic su un accordo sceglie dove «Aggiungi» inserisce lo sviluppo armonico.
- **Sezioni del brano**: progressioni separate per Intro, Verse, Chorus, Bridge…, salvate in SONG.md come `- Progressione (Chorus): ...`; MIDI e partiture prendono il nome della sezione.

## 0.3.0 — 2026-11-15

### Aggiunto
- **Pianoforte nella sezione Armonia**: ascolto della progressione con un pianoforte sintetizzato (nessun campione da scaricare), condotta delle parti automatica (basso nell'ottava 2–3, voci superiori con il minimo movimento), modo Accordi o Arpeggio, ripetizione, tempo dai BPM del brano, evidenziazione dell'accordo che suona; clic su un accordo per sentirlo da solo.
- **Righe di accordi ascoltabili nelle risposte**: le progressioni che l'agente scrive tra backtick (`Dm7/F G7 Am`) hanno un pulsante ▶.
- **Sviluppi armonici**: nuova scheda «Sviluppi» nel pannello destro con modelli realizzati nella tonalità del brano (cadenza evitata, 6/4 cadenzale, cadenza frigia, terza piccarda, catene di dominanti secondarie, progressioni di settime, 7ª diminuita, ritardo 4-3, pedale, modulazioni per accordo comune, salto di tono, progressione modulante, modulazione enarmonica, mediante cromatiche, sesta napoletana, seste aumentate, sostituzione di tritono, backdoor, prestito modale), con gradi, cambi di tonalità, spiegazione della condotta delle parti e pagina del De Ninno. Pulsanti Ascolta, Aggiungi, Sostituisci, Chiedi all'agente; filtro per tecnica; «Chiedi sviluppi su misura all'agente».
- **Tipo di composizione** del brano (Brano, Ballata, Sinfonia / orchestrale, Colonna sonora, Corale / esercizio, Jazz), salvato nel brief di SONG.md e passato agli agenti: ordina i suggerimenti secondo quanto sono idiomatici.

## 0.2.0 – 2026-11-13
- Prima versione installabile su Windows (installer NSIS) con aggiornamento automatico dalle Releases di GitHub.
- La cartella `studio-agent` si sceglie al primo avvio e si cambia dal menu dei brani; impostazioni, consumi e limiti stanno nella cartella utente dell'app.
- Risposte degli agenti in tempo reale; limiti del piano (finestra di 5 ore e settimanale) in alto e nella pagina Consumi.
- Schermata Armonia: griglia degli accordi, esportazione MIDI, controllo a quattro voci, pannello Fonte con pagine dei manuali e lettore PDF integrato.
- File prodotti dagli agenti (partiture, MIDI, checklist) nel pannello Brano.

## 0.1.0 – 2026-11-13
- Prima versione: brani con memoria, catena di produzione, consulto con gli agenti, misure dei file audio, consumi.
