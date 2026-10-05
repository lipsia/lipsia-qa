FROM cypress/included:16.1.1

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      novnc \
      websockify \
      supervisor \
      fluxbox \
      hsetroot \
      python3 \
      build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npx cypress verify

COPY . .

COPY docker/supervisord.conf /etc/supervisor/conf.d/app.conf
COPY docker/fluxbox-apps /root/.fluxbox/apps
COPY docker/fluxbox-init /root/.fluxbox/init
# Enforces read-only, scaled viewing in the noVNC client.
COPY docker/novnc-mandatory.json /usr/share/novnc/mandatory.json

RUN mkdir -p /app/data && touch /tmp/novnc-tokens

ENV DISPLAY=:99 \
    SCREEN_GEOMETRY=2560x1600x24 \
    DISPLAY_POOL_GEOMETRY=1920x1080x24 \
    DISPLAY_POOL_START=100 \
    DISPLAY_POOL_SIZE=20 \
    NOVNC_TOKEN_FILE=/tmp/novnc-tokens \
    DB_FILE=/app/data/control-center.sqlite

VOLUME ["/app/data"]

EXPOSE 9877 6080

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/app.conf"]
