# MelilloDesign: guida per il team

Questa guida accompagna un PC del team dalla prima installazione all'uso di tutti i giorni. La prima parte è per chi installa, cioè lo sviluppatore; le parti su avvio, aggiornamenti, backup e segnalazioni sono per l'ingegnere che usa il programma. Come si lavora a un documento di gara dentro MelilloDesign non è oggetto di queste pagine.

Tutti i comandi si danno da un terminale aperto nella cartella di MelilloDesign, attraverso `MelilloDesign.cmd`. Il file prepara da solo l'ambiente giusto, per cui non serve installare Node o pnpm a parte.

## Che cosa deve avere il PC

MelilloDesign si appoggia all'app Codex in due modi: ne usa l'agente per lavorare sui documenti e ne prende Node 24, pnpm e Python per far girare il programma. L'app Codex va quindi installata e aperta almeno una volta, con l'ingegnere collegato al proprio account. Quando Codex si aggiorna, MelilloDesign trova da solo la nuova versione.

Il resto è quello che serve per scaricare e compilare il programma:

- Windows 11;
- Git, con accesso in lettura al fork `TeamSuccursale/open-design` su GitHub;
- i percorsi lunghi di Git attivi (`git config --global core.longpaths true`), perché alcune cartelle del programma superano il limite di Windows;
- Visual Studio Build Tools 2022 con il carico di lavoro «Sviluppo di applicazioni desktop C++», necessari per compilare il database locale durante l'installazione.

I pacchetti Python per leggere i PDF si installano dopo: il controllo del PC indica il comando esatto.

## Prima installazione

La fa lo sviluppatore, una volta per PC.

1. Scarica il programma dal ramo `team`, in una cartella dell'ingegnere che non sia sincronizzata da OneDrive o simili:
   `git clone --branch team https://github.com/TeamSuccursale/open-design.git MelilloDesign`
2. Scegli la cartella in cui staranno i progetti e scrivila nel file `.env.local`, nella cartella di MelilloDesign, con una riga `OD_DATA_DIR=` seguita dal percorso. Conviene una cartella già coperta dal backup del PC. Va decisa adesso: se in seguito la si cambia su un PC che ha già dei progetti, l'app non li vede più, anche se restano nella cartella di prima. Il file `.env.local` non viene toccato dagli aggiornamenti.
3. Lancia `MelilloDesign.cmd install`. Il comando installa e compila il programma, cosa che richiede alcuni minuti, e alla fine esegue il controllo del PC.
4. Il controllo stampa una riga per ogni verifica: `OK` se è a posto, `DA FARE` con l'istruzione da eseguire se non lo è. Esegui le istruzioni e ripeti il controllo con `MelilloDesign.cmd doctor`, finché in fondo compare «Tutto pronto».
5. Avvia con `MelilloDesign.cmd` e apri nel browser l'indirizzo che il comando stampa (`http://127.0.0.1:17573`). In **Impostazioni → Informazioni** la riga **Build** deve mostrare il giro installato, per esempio `team-r1 · a0f9af34`.

Non serve impostare `CODEX_BIN`. Se un'installazione precedente l'ha scritto in `.env.local`, toglilo: punta a una versione precisa di Codex e smette di funzionare al primo aggiornamento dell'app.

## Avviare e fermare

- `MelilloDesign.cmd` avvia il programma; con `restart` lo riavvia, con `stop` lo ferma.
- `MelilloDesign.cmd status` dice se è in esecuzione.
- `MelilloDesign.cmd doctor` controlla il PC e, se qualcosa non va, dice che cosa fare.
- `MelilloDesign.cmd update` porta il PC al giro successivo.

Al primo avvio dopo l'installazione o dopo un aggiornamento il programma prepara la versione veloce delle pagine prima di aprirsi, e per questo serve circa un minuto. Gli avvii successivi riusano quel lavoro e la pagina si apre in pochi secondi. Se la preparazione non riesce, il programma parte lo stesso in una versione più lenta e lo scrive nella finestra: in quel caso segnalalo.

Il programma si ferma se il disco si riempie mentre lavora, e il lavoro in corso non si salva. Per questo, quando sul disco restano meno di 5 GB liberi, all'avvio lo scrive nella finestra e `MelilloDesign.cmd doctor` lo segna come cosa da fare. Il programma parte comunque, ma conviene liberare spazio prima di cominciare.

## Aggiornare

Gli aggiornamenti arrivano dal ramo `team`, che riceve soltanto i giri già provati. Ogni giro ha un nome, `team-r1`, `team-r2` e così via, che compare nella riga **Build** delle informazioni.

`MelilloDesign.cmd update` controlla per prima cosa che nessun agente stia lavorando: se c'è un lavoro in corso si ferma e chiede di aspettare che finisca, perché fermare il programma lo interromperebbe. Rifiuta anche quando sul PC sono stati modificati file del programma o ci sono modifiche salvate che il ramo `team` non ha, e in quel caso nomina i file. Non vanno sistemati a mano: chiedi a chi ha installato il PC. Se invece tutto è in ordine, il comando ferma il programma, scarica il giro nuovo, reinstalla e ricompila quando la versione è cambiata e riavvia. Quando il PC è già aggiornato lo dice e non tocca nulla.

Se l'installazione si interrompe, per esempio perché la rete cade, il programma non riparte con una versione installata a metà; il successivo `MelilloDesign.cmd update` ripete l'installazione.

## Dove stanno i progetti, e il backup

I progetti, con la loro cronologia, stanno nella cartella indicata in `OD_DATA_DIR`. `MelilloDesign.cmd doctor` la stampa nella riga «Cartella dei progetti». Le regole con cui il programma usa questa cartella sono nel [contratto sulla cartella dei dati](../AGENTS.md#daemon-data-directory-contract).

La cronologia del progetto permette di tornare a una versione precedente di un documento dopo una modifica sbagliata, ma sta nella stessa cartella dei progetti e si perde con il disco. Per questo la cartella dei progetti deve essere compresa nel backup normale del PC. Lo stesso vale per le cartelle di lavoro da cui un progetto è stato creato: i documenti di quei progetti restano lì e non vengono copiati nella cartella dei progetti.

Per una copia fatta a mano, ferma prima il programma con `MelilloDesign.cmd stop`, perché il database dei progetti viene scritto mentre l'app è aperta. Non spostare la cartella dei progetti e non cambiare `OD_DATA_DIR` senza averne parlato con chi ha installato il PC.

## Segnalare un problema

Una segnalazione si risolve in fretta quando dice su quale versione è avvenuto il problema. Apri **Impostazioni → Informazioni** e copia la riga **Build**; se contiene «con modifiche locali», sul PC sono cambiati file del programma rispetto al giro installato, e chi cerca di riprodurre il problema deve saperlo.

Apri poi una segnalazione sul fork `TeamSuccursale/open-design` su GitHub, o nel canale concordato con lo sviluppatore, indicando:

- la riga **Build**;
- il progetto e il documento su cui stavi lavorando;
- che cosa hai fatto, che cosa ti aspettavi e che cosa è successo;
- l'ora approssimativa, che permette di ritrovare il lavoro dell'agente;
- uno screenshot della schermata.

## Per lo sviluppatore: preparare un giro

Il ramo `team` avanza soltanto su commit già provati del ramo di sviluppo, e solo in avanti: gli aggiornamenti dei PC accettano esclusivamente un avanzamento lineare e rifiutano tutto il resto. Per pubblicare un giro:

```bash
git switch team
git merge --ff-only <commit provato>
git tag team-r2
git push origin team team-r2
```

Prima di consegnare il primo giro, la guida va provata su un PC, o su un account Windows nuovo, che non ha mai eseguito il programma, seguendo soltanto queste pagine. Ogni intervento a mano necessario durante la prova va riportato qui o trasformato in una verifica del controllo del PC.
