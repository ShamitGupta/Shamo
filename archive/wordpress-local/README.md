# shamoclasses.com WordPress archive

The WordPress site that served `shamoclasses.com` before the AWS migration.
It is **not** meant to stay online -- this directory exists so the site can be
read, referenced, or put back on the web at any point in the future.

## What to capture from Hostinger, before DNS moves

Take the backup while the site is still live. Two pieces:

1. **Files** -- hPanel -> Websites -> (site) -> Files -> Backups -> *Files backup*.
   Only `wp-content/` genuinely matters: themes, plugins, uploads. WordPress
   core is identical for a given version and comes from the Docker image.
   Keep `wp-config.php` separately for reference (it records the table prefix,
   which the restore needs if it is not the default `wp_`).
2. **Database** -- same Backups page, *Database backup*. Or
   hPanel -> Databases -> phpMyAdmin -> Export -> Go, which yields a `.sql` file.

Keep both. The database holds every post, page, setting and menu; the files
hold the theme, plugins and media. Neither is usable without the other.

## Laying it out

```
archive/wordpress-local/
  docker-compose.yml
  restore.sql        <- the database dump, named exactly this
  wp-content/        <- unpacked from the files backup
    themes/
    plugins/
    uploads/
```

## Running it

```bash
cd archive/wordpress-local
docker compose up -d
```

Then open <http://localhost:8080>.

The SQL dump is imported automatically, but **only on the very first start**,
while the database volume is still empty. If you start the stack before
putting `restore.sql` in place, WordPress creates an empty database and will
offer you a fresh install. Recover by wiping the volume and starting again:

```bash
docker compose down -v     # -v deletes the database volume
docker compose up -d
```

## If the site redirects you to shamoclasses.com

The dump still contains the live site's URLs in `wp_options`. The compose file
sets `WP_HOME` and `WP_SITEURL` to `localhost:8080` to override that at
runtime, which handles most of it. If individual posts still reference the old
domain in their content (common for embedded images), fix the stored values:

```bash
docker compose exec wordpress bash -c \
  'cd /var/www/html && \
   curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && \
   php wp-cli.phar --allow-root search-replace "https://shamoclasses.com" "http://localhost:8080" --skip-columns=guid'
```

`--skip-columns=guid` is deliberate: GUIDs are permanent identifiers, not
links, and rewriting them makes feed readers treat every old post as new.

## Putting it back on the web later

The same two artifacts restore to any WordPress host -- Hostinger included.
Upload `wp-content/`, import `restore.sql`, point `wp-config.php` at the new
database, and run the `search-replace` above with the real domain as the
target. Nothing here locks the site to Docker.

## Do not delete the Hostinger account casually

`shamoclasses.com` email (MX, SPF, DKIM) is served by Hostinger and is
**staying** there after the migration. Cancelling the hosting plan may take
mailboxes with it, depending on whether the email is a bundled or standalone
product. Confirm with Hostinger support before cancelling anything.
