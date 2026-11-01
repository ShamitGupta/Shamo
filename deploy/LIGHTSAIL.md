# Deploying the demo on AWS Lightsail

One Lightsail server runs the whole app with Docker:

```text
Browser ──HTTPS──▶ web container (Caddy)
                     ├─ "/"     → the React app
                     └─ "/api"  → api container (FastAPI + Manim)
                                     ├─ Supabase (database, sign-in, files)
                                     └─ OpenAI (tutor replies)
```

The React app calls the backend at `/api` on the same address it was loaded
from, so the build never names a server and keeps working if the address
changes. Supabase and OpenAI stay where they are; nothing about them moves.

This is a prototype setup: one server, no redundancy, no rate limiting.
Share the link only with people you trust -- every tutor reply costs OpenAI
credit.

Allow about 30 minutes the first time.

---

## 1. Create the server

In the [Lightsail console](https://lightsail.aws.amazon.com/):

1. **Create instance**
   - Region: **Singapore** (or whichever is closest to your users)
   - Platform: **Linux/Unix**, blueprint **OS Only -> Ubuntu 24.04 LTS**
   - Plan: **2 GB RAM** (about USD 12/month). Measured: the app peaks around
     450 MB while rendering an animation, so 2 GB is comfortable.
   - Name it, e.g. `shamo-demo`, and create it.
2. **Networking tab -> Create static IP**, attach it to the instance. Without
   this the address changes whenever the server restarts.
3. **Instance -> Networking -> IPv4 Firewall -> Add rule -> HTTPS (443)**.
   SSH (22) and HTTP (80) are open by default; keep both. Port 80 is needed to
   obtain the HTTPS certificate even though visitors end up on HTTPS.

Write down the static IP, e.g. `13.250.10.20`.

## 2. Choose the web address

Either of these works; HTTPS is set up automatically for both.

| Option | Address | Setup |
| --- | --- | --- |
| No domain | `13.250.10.20.sslip.io` (your IP + `.sslip.io`) | None. sslip.io is a free public service that turns any IP into a hostname. |
| Your domain | `demo.shamoclasses.com` | Add an **A record** for `demo` pointing at the static IP wherever shamoclasses.com's DNS is managed. Wait until it resolves. |

## 3. Install Docker

Click **Connect using SSH** on the instance page. In the terminal that opens,
paste these one block at a time.

Add 2 GB of swap, so the first build cannot run out of memory:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install Docker and Compose from Ubuntu's own packages:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 docker-buildx git
```

Let your user run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
```

**Close the SSH window and connect again** so that last change takes effect.
Check it worked:

```bash
docker compose version
```

## 4. Get the code

```bash
git clone https://github.com/ShamitGupta/Shamo.git && cd Shamo
```

## 5. Add your settings

```bash
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env && nano deploy/.env
```

Fill in every value. The file explains each one; in short:

- `SITE_ADDRESS` -- the address from step 2, **without** `https://`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
  `SHAMO_TEACHER_INVITE_CODE` -- copy from `backend_v2/.env` on your laptop.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_DESMOS_API_KEY`
  -- copy from `frontend/.env` on your laptop.

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

This file holds the keys that matter most. It never leaves the server: it is
ignored by git and excluded from both Docker images.

## 6. Start it

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

The first build takes several minutes (it installs the animation renderer).
Then check both containers are up -- `api` should say `healthy` within a minute:

```bash
docker compose -f deploy/docker-compose.yml ps
```

Open `https://<your SITE_ADDRESS>` in a browser. The paper selector should list
the papers. If it does, the server, Caddy, the API and Supabase all work.

## 7. Let sign-in return to the demo

Supabase only redirects back to addresses it has been told about.

Supabase Dashboard -> **Authentication -> URL Configuration -> Redirect URLs ->
Add URL**: `https://<your SITE_ADDRESS>/**`

Google sign-in needs nothing else: Google returns to Supabase, which returns to
the demo.

---

## Everyday commands

Run these from the `Shamo` folder on the server.

| What | Command |
| --- | --- |
| Deploy new code from GitHub | `git pull && docker compose -f deploy/docker-compose.yml up -d --build` |
| See the API's logs | `docker compose -f deploy/docker-compose.yml logs -f api` |
| See Caddy's logs (certificate problems) | `docker compose -f deploy/docker-compose.yml logs -f web` |
| Restart after editing `deploy/.env` | `docker compose -f deploy/docker-compose.yml up -d --build` |
| Stop everything | `docker compose -f deploy/docker-compose.yml down` |

`--build` is needed after editing `deploy/.env` too: the frontend values are
baked in when the image is built.

The containers restart on their own after a crash or a server reboot.

## When something is wrong

- **The page will not load over HTTPS.** Check port 443 is open (step 1.3) and
  that the address resolves to the static IP. Then read
  `docker compose -f deploy/docker-compose.yml logs web` -- Caddy says exactly
  why a certificate could not be issued.
- **The paper dropdowns are empty, or "Could not reach the tutor".** The API is
  down or cannot reach Supabase. Read the `api` logs. The most likely cause is
  the **Supabase free plan pausing after a week without use** -- restore it in
  the Supabase dashboard. Open the demo the day before you show it.
- **Signing in returns you to `localhost` or the wrong site.** Step 7 is missing
  or has a typo.
- **Desmos graphs stay blank.** The Desmos key may be limited to certain sites;
  add the demo's address in your Desmos API settings.
- **The server feels stuck during a build.** It is probably still installing;
  the first build is slow on 2 GB. The swap file from step 3 is what keeps it
  from failing.

## Costs and turning it off

- Lightsail bills the instance while it exists, **even when stopped**. To stop
  paying, delete the instance -- and delete the static IP, which is free only
  while attached to a running instance.
- OpenAI charges per tutor reply; Supabase is free until you upgrade.
