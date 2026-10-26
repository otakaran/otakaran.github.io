# www redirect Worker

Sends `www.otakar.dev/*` to `https://otakar.dev/*` with a 301. Deployed with the
Cloudflare custom-domain route, which also creates the `www` DNS record and certificate.

```bash
cd www-redirect && ../worker/node_modules/.bin/wrangler deploy
```

Verify afterwards:

```bash
dig +short www.otakar.dev
curl -sI "https://www.otakar.dev/x?y=1" | grep -i '^HTTP\|^location'   # 301 -> https://otakar.dev/x?y=1
```
