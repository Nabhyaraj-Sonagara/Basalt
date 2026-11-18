# Running Basalt Sync on AWS

Basalt Sync stores each user's hives **end-to-end encrypted**. The apps encrypt notes, file names and hive names before upload, so the server holds ciphertext, plus email addresses, sizes and timestamps.

There's no password reset, because the server can't decrypt anything. A user who forgets their password still has their notes on their own devices, but loses the synced copy.

This guide runs everything on one EC2 instance with Docker: the sync server, Postgres and Caddy (automatic HTTPS). One script sets it all up.

## Sync is for notes

Basalt Sync is meant for notes, not general file storage.

- **The apps sync notes only:** Markdown (mind maps included), canvases, HTML pages, and the small text files Basalt keeps beside them (settings, plugins, themes).
- **Attachments don't sync.** Images, PDFs, audio, video and other binaries stay on the device they were added on.

The server can't see what it stores, so it can't check file types. It enforces sizes instead, which a modified client can't get around:

| Limit | Default | Setting |
|---|---|---|
| Largest note | 2 MiB | `MAX_FILE_BYTES` |
| Storage per account | 100 MiB | `QUOTA_BYTES` |
| Files per account | 20,000 | `MAX_FILES` |
| Uploads plus downloads per account per day | 1 GiB | `TRANSFER_BYTES_PER_DAY` |
| Accounts on the server | 100 | `MAX_USERS` |
| Largest request (Caddy) | 8 MB | `Caddyfile` |

For scale, a long note is around 20 KB, so 100 MiB holds thousands of notes. 100 accounts × 100 MiB is about 10 GiB at most, which fits the disk below.

When a note goes over a limit, the app skips it and lists it under **Settings → Sync → Not synced**. A full account or a used-up daily allowance shows as a sync error with the reason.

## What it costs

These are approximate us-east-1 on-demand prices; check the AWS pricing pages for your region.

| | Per month |
|---|---|
| `t4g.small` instance (2 vCPU, 2 GiB) | about $12 |
| 20 GiB gp3 disk | about $1.60 |
| Public IPv4 address | about $3.60 |
| Data out | the first 100 GB are free |
| **Total** | **about $17** |

For a few people, a `t4g.micro` (1 GiB) runs the same setup for about $6 less.

[Lightsail](https://aws.amazon.com/lightsail/) is a simpler alternative. A $7 Ubuntu instance includes the IP address and 2 TB of transfer, and the setup script works there too.

## 1. Launch an instance

In the EC2 console, choose **Launch instance**:

- **Name:** `basalt-sync`.
- **AMI:** Ubuntu Server 24.04 LTS, **64-bit (Arm)**.
- **Instance type:** `t4g.small`.
- **Key pair:** create one, or pick an existing one, so you can SSH in.
- **Network settings:** allow **HTTPS** and **HTTP** from the internet. Caddy needs port 80 to get its certificate. Allow **SSH** from **My IP** only.
- **Storage:** 20 GiB gp3. Turn on **Encrypted** (under Advanced) so the disk is encrypted at rest as well.
- **Advanced details → User data:** paste these two lines, with your domain in place of `sync.example.com`. The server then sets itself up on first boot.

  ```
  #!/bin/sh
  curl -fsSL https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/deploy/aws/setup.sh | sh -s -- sync.example.com
  ```

Then, under **Elastic IPs**, allocate an address and associate it with the instance, so the address stays the same across restarts.

## 2. Point a domain at it

At your DNS provider (or Route 53), create an **A record** for the name you chose, for example `sync.yourdomain.com`, pointing at the Elastic IP. Check it from your own computer:

```bash
dig +short sync.yourdomain.com
```

It should print the Elastic IP. Caddy keeps retrying until the record works, then fetches a certificate by itself.

## 3. Check it's running

```bash
curl https://sync.yourdomain.com/healthz
```

It answers `{"ok":true}`. This can take a few minutes after launch while Docker installs and the certificate is issued.

**If you didn't use User data, or something went wrong,** SSH in and run the script yourself. It's safe to run again:

```bash
curl -fsSL https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/deploy/aws/setup.sh | sudo sh -s -- sync.yourdomain.com
```

The script does the following:
- installs Docker
- puts the server files in `/opt/basalt`
- writes `/opt/basalt/.env` with freshly generated secrets
- starts everything
- tells you what to fix if HTTPS isn't working yet, usually DNS or a closed port 80

The first-boot log is at `/var/log/cloud-init-output.log`.

**Save a copy of `/opt/basalt/.env`** somewhere private, such as a password manager. It holds the database password and the server secret.

## 4. Point the app at it

In Basalt, open **Settings → Sync**, enter `https://sync.yourdomain.com`, create an account and start syncing a hive.

To make the server the default for everyone who downloads Basalt:
1. Set the repository variable **`SYNC_URL`** to the address, under GitHub → Settings → Secrets and variables → Actions → Variables.
2. Tag a release. The release workflow builds the address into the apps.

## 5. Set a billing alarm

In **Billing → Budgets**, create a monthly cost budget (for example $25) with an email alert. If something unexpected starts costing money, you'll hear about it the same day.

## Changing settings

Edit `/opt/basalt/.env`, then apply the change:

```bash
cd /opt/basalt && sudo docker compose up -d
```

- **Run a private server:** create your own accounts first, then set `ALLOW_SIGNUP=false`. There's no email verification yet, so with sign-ups open anyone who knows the address can create an account, up to `MAX_USERS`.
- **Allow bigger notes:** raise `MAX_FILE_BYTES`, and keep the `max_size` in `Caddyfile` a little above it.

| Variable | Default | Meaning |
|---|---|---|
| `SYNC_DOMAIN` | — | The public DNS name. Caddy gets its certificate. |
| `POSTGRES_PASSWORD` | generated | Database password. |
| `SERVER_SECRET` | generated | At least 32 characters. Used so sign-in doesn't reveal which emails have accounts. |
| `QUOTA_BYTES` | 100 MiB | Storage per account. |
| `MAX_FILE_BYTES` | 2 MiB | Largest file that syncs. |
| `MAX_FILES` | 20000 | Files per account. |
| `TRANSFER_BYTES_PER_DAY` | 1 GiB | Uploads plus downloads per account per UTC day. `0` turns it off. |
| `MAX_USERS` | 100 | Most accounts. `0` means no limit. |
| `ALLOW_SIGNUP` | `true` | Set to `false` to stop new accounts. |
| `S3_BUCKET`, `S3_REGION` | — | Store encrypted files in S3 instead of on disk. |
| `SYNC_IMAGE` | `…/basalt-sync:latest` | Pin a server version, for example `ghcr.io/nabhyaraj-sonagara/basalt-sync:v0.3.0`. |

## Upgrades

The release workflow publishes `ghcr.io/nabhyaraj-sonagara/basalt-sync` with each version tag. To upgrade, run the setup script again without a domain. It refreshes the compose files, pulls the new image and keeps your `.env`:

```bash
curl -fsSL https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/deploy/aws/setup.sh | sudo sh
```

Database migrations run automatically when the server starts.

## Backups

`backup.sh` dumps Postgres to S3 every night, along with the encrypted files when they're on disk. Everything in it except emails and sizes is already encrypted by the apps.

1. Create an S3 bucket for backups.
2. Attach an IAM role to the instance that can write to the bucket: EC2 → the instance → Actions → Security → Modify IAM role.
3. Install the AWS CLI:

   ```bash
   sudo snap install aws-cli --classic
   ```

4. Set `BACKUP_S3_URI` in `/opt/basalt/.env`, for example `s3://your-bucket/basalt-backups`.
5. Schedule it with `sudo crontab -e`:

   ```
   15 3 * * * cd /opt/basalt && ./backup.sh >> backup.log 2>&1
   ```

Add an S3 lifecycle rule to expire old backups, for example after 30 days.

To restore the database into a fresh install:

```bash
sudo docker compose exec -T db pg_restore -U basalt -d basalt --clean < basalt-<stamp>.dump
```

## Storing files in S3 instead of on disk

Notes are small, so the disk is usually enough. If you'd rather use S3:
1. Set `S3_BUCKET` and `S3_REGION` in `.env`.
2. Give the instance's IAM role `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on that bucket.
3. Restart with `docker compose up -d`.

Switch before users start syncing, because existing files aren't copied across.

## Not built yet

Email verification and password-change notifications need an email provider, for example Amazon SES. They're the next step.
