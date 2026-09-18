# syntax=docker/dockerfile:1

# Container image for the backend_v2 tutor API.
#
# Build from the REPOSITORY ROOT, not from this directory:
#   docker build -f deploy/Dockerfile -t shamo-api .
# (docker-compose.yml in this directory already sets the context correctly.)

# ---- builder ---------------------------------------------------------------
FROM python:3.12-slim AS builder

# pycairo and a few of Manim's dependencies still compile from source on Linux
# whenever no manylinux wheel matches the interpreter, so the build stage needs
# headers and a compiler. None of this reaches the runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        libcairo2-dev \
        libpango1.0-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY backend_v2/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt

# ---- runtime ---------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Runtime shared libraries only.
#
# No LaTeX. Every scene in app/manim_templates/ deliberately renders its labels
# with Text() rather than MathTex, so the ~2GB texlive install that Manim setup
# guides normally insist on is genuinely not needed here. If a future template
# introduces MathTex this image will fail at render time, not at build time --
# add texlive then, and expect the image to grow by an order of magnitude.
#
# No ffmpeg either: imageio-ffmpeg ships a static binary and
# manim_renderer._ffmpeg_exe() already prefers it over a system one.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libcairo2 \
        libpangocairo-1.0-0 \
        libgl1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home --uid 10001 shamo
WORKDIR /app
COPY backend_v2/app ./app
RUN chown -R shamo:shamo /app
USER shamo

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

# Two workers for a 2-vCPU box. /visualize is a sync `def`, so FastAPI already
# runs it in a threadpool and a 60s Manim render cannot block the event loop --
# the worker count is about CPU parallelism, not request concurrency. Each
# worker holds its own Manim import (~300MB resident), so do not raise
# WEB_CONCURRENCY without raising the instance size to match.
#
# PORT and WEB_CONCURRENCY are read from the environment so one image serves
# both deployment targets. docker-compose sets neither and gets 8000/2, which
# is what the Caddyfile proxies to. A PaaS that assigns its own port (Railway
# injects PORT) is honoured without a second Dockerfile or an overridden start
# command. Shell form is required for the expansion, and `exec` keeps uvicorn
# as PID 1 so it still receives SIGTERM directly and shuts down gracefully.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --workers \"${WEB_CONCURRENCY:-2}\""]
