# StreamHub - S3 Series Player

Un player web moderno per le tue serie TV ospitate su S3, con tracciamento dei progressi tramite DuckDB WASM e Parquet.

## Funzionalità
- 🔒 Autenticazione S3 Client-side (nessun server backend richiesto)
- 📂 Navigazione Serie -> Stagione -> Episodio
- ☁️ Sincronizzazione progressi su file Parquet nel bucket S3
- ⏯️ Auto-resume degli episodi
- 🎨 Interfaccia Glassmorphism moderna

## Come avviare

Poiché l'applicazione usa ES Modules e WASM, deve essere servita tramite un web server locale (non basta aprire il file html).

### Python
```bash
cd series_player
python3 -m http.server 8000
```
Poi apri http://localhost:8000

### Node.js
```bash
cd series_player
npx serve .
```

## Struttura Bucket Richiesta
Il bucket deve avere questa struttura di cartelle:
```
Serie TV/
  Stagione 1/
    Episodio 1.mp4
    Episodio 2.mp4
```
L'app scansiona tutto il bucket e raggruppa automaticamente.

## Sicurezza
Le credenziali inserite rimangono nella memoria del browser e vengono usate solo per comunicare direttamente con S3. Non vengono inviate a nessun altro server.
