# lucky-me.app Static Site

Static public pages for:

- `https://lucky-me.app`
- `https://lucky-me.app/terms/`
- `https://lucky-me.app/privacy/`
- `https://lucky-me.app/support/`

Deployment target on the VPS:

`/var/www/luckyme/public`

The API subdomain is handled separately by nginx and proxies to the LuckyMe
backend on `127.0.0.1:8788`.

