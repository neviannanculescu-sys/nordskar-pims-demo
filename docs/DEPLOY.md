# Nordskar PIMS — Ghid Deploy

## Arhitectură curentă

```
demo.html  (sursă)
    │
    ▼  deploy.ps1
deploy-demo/index.html  (build)
    │
    ├──► Cloudflare Pages  →  https://nordskar-pims-demo.pages.dev  (LIVE)
    └──► GitHub            →  https://github.com/neviannanculescu-sys/nordskar-pims-demo  (backup)
```

## Deploy standard

```powershell
.\deploy.ps1
```

Scriptul face automat:
1. Copiază `demo.html` → `deploy-demo/index.html`
2. Uploadează pe Cloudflare Pages (Direct Upload, fără build)
3. Commit + push pe GitHub

## Opțiuni

```powershell
.\deploy.ps1                        # deploy standard, mesaj automat cu timestamp
.\deploy.ps1 -Message "fix: login"  # deploy cu mesaj custom de commit
.\deploy.ps1 -DryRun                # pregătire fișiere fără upload
```

## Prerequisite (o singură dată per mașină)

```powershell
# 1. Node.js instalat (node --version)
# 2. Autentificare Cloudflare
npx wrangler login

# 3. Git configurat cu GitHub
git remote -v   # trebuie să afișeze origin -> github.com/...
```

## Configurare domeniu custom (când suntem gați)

1. În Cloudflare Dashboard → Workers & Pages → `nordskar-pims-demo` → Custom Domains
2. Adaugă domeniul (ex: `demo.nordskar.ro`)
3. Cloudflare configurează automat DNS + SSL

**Notă**: domeniul trebuie să fie pe același cont Cloudflare sau să ai acces la DNS-ul lui.

## Structura repo

```
/
├── demo.html                  ← SURSĂ — editează aici
├── deploy-demo/
│   └── index.html             ← BUILD — generat automat de deploy.ps1
├── deploy.ps1                 ← script deploy
├── apps/api/                  ← backend NestJS (viitor)
└── docs/
    └── DEPLOY.md              ← acest fișier
```

## Troubleshooting

| Problemă | Soluție |
|---|---|
| `Not authenticated` | Rulează `npx wrangler login` |
| `Project not found` | Rulează `npx wrangler pages project create nordskar-pims-demo --production-branch main` |
| `git push` eșuat | Verifică `git remote -v` și credențiale GitHub |
| Modificările nu apar live | Hard refresh în browser: `Ctrl+Shift+R` |
