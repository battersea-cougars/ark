FROM node:24

# Battersea Cougars dev image (based on the Gwenda ark image).

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gh \
        jq \
        sudo \
        curl \
        python3 \
        python3-pip \
        python3-venv \
        imagemagick \
        ripgrep \
        fd-find \
        pandoc \
        poppler-utils \
        tesseract-ocr \
        csvkit \
        qpdf \
        unzip \
    && rm -rf /var/lib/apt/lists/* \
    && echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN ln -sf "$(command -v fdfind)" /usr/local/bin/fd || true

RUN python3 -m pip install --break-system-packages --no-cache-dir \
        httpx \
        pyyaml \
        ruff \
        pandas \
        openpyxl \
        python-docx \
        pypdf \
        tabulate

# Bitwarden CLI — bw-unlock (see bw-session.bashrc)
RUN npm install -g @bitwarden/cli@2026.8.0 --allow-scripts=core-js

# Secrets Manager CLI — scripts/env-pull.mjs reads secrets into memory (docs/setup.md)
RUN curl -sL -o /tmp/bws.zip \
      "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-x86_64-unknown-linux-gnu-2.1.0.zip" \
    && unzip -o -j /tmp/bws.zip bws -d /usr/local/bin \
    && chmod 755 /usr/local/bin/bws \
    && rm -f /tmp/bws.zip \
    && bws --version

# Firebase and Google Cloud CLIs: scripted setup of the Firebase project, its apps and service accounts (ADR 0108).
# Their sign-ins live in volumes (devcontainer.json), so a rebuild keeps them.
RUN npm install -g firebase-tools@15.32.1
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
        > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-cloud-cli \
    && rm -rf /var/lib/apt/lists/*

ARG USERNAME=node

RUN \
    mkdir -p /home/${USERNAME}/.config /home/${USERNAME}/.config/pnpm /home/${USERNAME}/.config/gcloud /home/${USERNAME}/.config/configstore /home/${USERNAME}/.pnpm-store \
    && printf "store-dir=/home/${USERNAME}/.pnpm-store\n" > /home/${USERNAME}/.config/pnpm/rc \
    && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config /home/${USERNAME}/.pnpm-store

RUN mkdir -p /src/node_modules /home/${USERNAME}/.npm \
    && chown -R ${USERNAME}:${USERNAME} /src/node_modules /home/${USERNAME}/.npm

RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    && mkdir /commandhistory \
    && touch /commandhistory/.bash_history \
    && chown -R $USERNAME /commandhistory \
    && echo "$SNIPPET" >> "/home/$USERNAME/.bashrc"

RUN grep -qxF "alias python=python3" "/home/$USERNAME/.bashrc" \
    || echo "alias python=python3" >> "/home/$USERNAME/.bashrc"

# The Bitwarden session snippet (bw-unlock / bw-lock) is installed into
# ~/.bashrc by post-start.sh from bw-session.bashrc, on every start.
