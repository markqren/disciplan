# The Disciplan

Accrual-based personal finance tracker. Single-page app connecting to Supabase backend.

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
