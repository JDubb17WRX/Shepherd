#!/bin/sh
set -eu
if [ "${SHEPHERD_SKIP_MIGRATION:-0}" != 1 ]; then
    php /opt/shepherd/migrate.php
fi
core=/var/www/html/shepherd/plugins/core
test ! -L "$core"
mkdir -p "$core"
find "$core" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R /opt/shepherd/core-plugins/. "$core/"
exec frankenphp run --config /etc/caddy/Caddyfile
