# Changelog

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
