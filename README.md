# huddlecode.com — Mike's website

The website for [Mike](https://github.com/navdeepcodes/NavAI), in the same
design as the desktop app (its palette, Source Serif 4, the nib), with a live
in-browser preview at **/chat**.

It's a Cloudflare Worker with static assets:

| Path | What it is |
|---|---|
| `public/` | The site: home, `/chat/`, `/privacy/`, `/terms/`, 404, icons, screenshots |
| `public/assets/site.css` | The design system shared by every page (light and dark) |
| `src/worker.js` | `/api/chat` — the preview's model call, rate limit and fallback. Everything else is static |
| `scripts/build_legal.py` | Builds `/privacy/` and `/terms/` from the app's own `docs/legal/*.md` |
| `test/` | Tests for the Worker (NVIDIA's API is replaced by a stand-in) |

## The /chat preview

A real conversation with a cloud model prompted as Mike and given Mike's real
tool names. It can't touch the visitor's computer, so when a request needs
one, the tool Mike would use comes back as **"On your computer, Mike would…"**
with a link to get the app.

- Model: `nvidia/nemotron-3.5-lightning-30b-a3b` (reasoning off), falling back
  to `qwen/qwen3-next-80b-a3b-instruct` — both set in `MODELS` in
  `src/worker.js`. `CHAT_API_URL` points it at any OpenAI-compatible endpoint.
- The API key lives only in Cloudflare, as a secret. Without it the preview
  says it's resting instead of failing.
- 20 messages a minute per IP address (`ratelimits` in `wrangler.jsonc`);
  NVIDIA's own limit on a free key is about 40 a minute, and hitting it shows
  visitors a "busy" notice, not an error.
- Messages are bounded (8 turns, 500 characters each), other sites can't call
  the API, and conversations are never logged or stored — only kept in the
  visitor's tab.

## Deploying

```sh
npm install
npx wrangler login
npx wrangler secret put NVIDIA_API_KEY     # paste the key when asked
npx wrangler deploy
```

## Working on it

```sh
npm install
printf 'NVIDIA_API_KEY="nvapi-…"\n' > .dev.vars   # git-ignored
npx wrangler dev                                  # http://localhost:8787
npm test
```

After the app's Privacy Policy or Terms change:

```sh
python3 scripts/build_legal.py ../NavAI/docs/legal
```

Screenshots in `public/img/` are rendered from the real app (light and dark).
