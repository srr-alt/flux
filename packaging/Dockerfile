ARG BASE_IMAGE=ubuntu:22.04
FROM ${BASE_IMAGE}

ARG WEBKIT_PKG=libwebkit2gtk-4.0-dev
ENV DEBIAN_FRONTEND=noninteractive

# Tauri v2 Linux prerequisites. WEBKIT_PKG varies by Ubuntu release:
# 20.04/22.04 ship libwebkit2gtk-4.0-dev; 24.04+ dropped it for the
# libsoup3-based -4.1 package.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    ca-certificates \
    gnupg \
    build-essential \
    file \
    rsync \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    librsvg2-dev \
    libayatana-appindicator3-dev \
    libxdo-dev \
    ${WEBKIT_PKG} \
    && rm -rf /var/lib/apt/lists/*

# Nodesource's setup script now serves a single "nodistro" repo, so it
# works the same across all Ubuntu releases here regardless of codename.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal

WORKDIR /work
