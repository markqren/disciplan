# The Disciplan

Accrual-based personal finance tracker. Single-page app connecting to Supabase backend.

## 📋 Roadmap

- **[ROADMAP.md](./ROADMAP.md)** — Master roadmap (consolidated, human-readable)
- **[roadmap/ACTIVE.md](./roadmap/ACTIVE.md)** — Next Up + Future (what's planned)
- **[roadmap/RELEASES.md](./roadmap/RELEASES.md)** — v0.5–v2.1 release history
- **[roadmap/COMPLETED.md](./roadmap/COMPLETED.md)** — 118 completed items (searchable)

**Editing:** Always edit `ROADMAP.md`. The `roadmap/` split files sync on the next Claude Code session.

## Deploy

Hosted on Netlify. To update:

```bash
git add -A && git commit -m "update" && git push
```

Netlify auto-deploys from the `main` branch.

## Architecture

- **Frontend**: Single `index.html` file (vanilla JS + Chart.js CDN)
- **Backend**: Supabase (PostgreSQL + REST API)
- **Accrual engine**: SQL views (`daily_accruals`, `monthly_income_statement`)
- **Hosting**: Netlify (free tier)
