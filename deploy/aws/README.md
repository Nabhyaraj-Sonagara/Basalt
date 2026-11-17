# Running Basalt Sync on AWS

Basalt Sync stores each user's hives **end-to-end encrypted**: the apps encrypt notes, file names and hive names before upload, so the server holds ciphertext, email addresses, sizes and timestamps. There's no password reset, because the server can't decrypt anything; a user who forgets their password still has their notes on their own devices but loses the synced copy.

This guide runs everything on a single EC2 instance with Docker: the sync server, Postgres and Caddy (automatic HTTPS). It comfortably serves thousands of light users; move Postgres to RDS and files to S3 when you outgrow it.

## 1. Launch an instance

- **AMI:** Ubuntu Server 24.04 LTS (arm64 or x86_64).
- **Type:** `t4g.small` (2 vCPU, 2 GiB) to start.
- **Storage:** a 30 GiB gp3 root volume, or more if you keep files on disk rather than in S3. Encrypted files take about the same space as the originals.
- **Security group:** allow inbound TCP 80 and 443 from anywhere (Caddy needs 80 for certificates), and TCP 22 from your own IP only.
- **Elastic IP:** allocate one and associate it, so the address survives restarts.

## 2. Point a domain at it

Create a DNS **A record**, for example `sync.yourdomain.com`, pointing at the Elastic IP. Wait until `dig +short sync.yourdomain.com` returns it.

## 3. Install Docker

SSH in, then:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER && newgrp docker
```

## 4. Configure and start

```bash
sudo mkdir -p /opt/basalt && sudo chown $USER /opt/basalt && cd /opt/basalt
```

Copy `docker-compose.yml`, `Caddyfile`, `.env.example` and `backup.sh` from this folder into `/opt/basalt` (for example with `scp`), then:

```bash
cp .env.example .env && chmod 600 .env
```

Edit `.env`: set `SYNC_DOMAIN`, and fill `POSTGRES_PASSWORD` and `SERVER_SECRET` with values from `openssl rand -hex 32`. Then start it:

```bash
docker compose up -d
```

Check it's healthy (Caddy fetches a certificate on first start, which can take a minute):

```bash
curl https://sync.yourdomain.com/healthz
```

It answers `{"ok":true}`.

## 5. Point the app at it

In Basalt, open **Settings → Sync**, enter `https://sync.yourdomain.com`, create an account and connect a hive. To make it the default for everyone who downloads Basalt, set the repository variable **`SYNC_URL`** (GitHub → Settings → Secrets and variables → Actions → Variables) before tagging a release; the release workflow builds it in.

## Upgrades

The release workflow publishes `ghcr.io/nabhyaraj-sonagara/basalt-sync` with each version tag. To upgrade:

```bash
cd /opt/basalt && docker compose pull && docker compose up -d
```

Database migrations run automatically when the server starts.

## Backups

`backup.sh` dumps Postgres (and the encrypted files, when they're on disk) to S3 every night.

1. Create an S3 bucket for backups, and attach an IAM role to the instance that can write to it.
2. Install the AWS CLI: `sudo snap install aws-cli --classic`.
3. Set `BACKUP_S3_URI` in `.env`, for example `s3://your-bucket/basalt-backups`.
4. Schedule it with `crontab -e`:

```
15 3 * * * cd /opt/basalt && ./backup.sh >> backup.log 2>&1
```

Add an S3 lifecycle rule to expire old backups (for example after 30 days).

To restore the database into a fresh install:

```bash
docker compose exec -T db pg_restore -U basalt -d basalt --clean < basalt-<stamp>.dump
```

## Storing files in S3 instead of on disk

Set `S3_BUCKET` and `S3_REGION` in `.env`, give the instance's IAM role `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on that bucket, and restart with `docker compose up -d`. Switch before users start syncing; existing files aren't copied across.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `SYNC_DOMAIN` | — | The public DNS name. Caddy gets its certificate. |
| `POSTGRES_PASSWORD` | — | Database password. |
| `SERVER_SECRET` | — | At least 32 characters. Used so sign-in doesn't reveal which emails have accounts. |
| `QUOTA_BYTES` | 1 GiB | Storage per account. |
| `MAX_FILE_BYTES` | 100 MiB | Largest file that syncs. |
| `ALLOW_SIGNUP` | `true` | Set to `false` to stop new accounts. |
| `S3_BUCKET`, `S3_REGION` | — | Store encrypted files in S3. |

## Not built yet

Email verification and password-change notifications need an email provider (for example Amazon SES); they're the next step. Until then anyone can sign up with any email address, so keep `ALLOW_SIGNUP=false` if you only want accounts you create yourself (sign up first, then turn it off).
