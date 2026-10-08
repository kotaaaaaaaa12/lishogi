# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS node

FROM eclipse-temurin:21-jdk-jammy AS build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git g++ make python3 \
 && npm install -g pnpm@10.6.5 \
 && rm -rf /var/lib/apt/lists/*
ARG LILA_WS_COMMIT=4329e717f2ddebcfd3f167897199ec4ee02f90c5
ARG SHOGINET_COMMIT=2669e52994445e772a043fa76f471b7a8b2ba884
ARG YANEURAOU_COMMIT=c1b80eaa09fe13d5f12b1599d1ae4d53c224de30
ARG FAIRY_COMMIT=9f778da667f6e07dae1e85d3e2ea204fc6dee94d
WORKDIR /build/lishogi
COPY . .
RUN test -f build.sbt && test -f pnpm-lock.yaml \
 && cp conf/application.conf.default conf/application.conf \
 && pnpm install --frozen-lockfile \
 && pnpm server:i18n \
 && pnpm server:icons \
 && pnpm run --parallel build --prod
RUN curl -fsSL --retry 3 -o /build/sbt-launch.jar \
    https://repo.maven.apache.org/maven2/org/scala-sbt/sbt-launch/1.11.7/sbt-launch-1.11.7.jar \
 && java -Xmx4g -jar /build/sbt-launch.jar stage
WORKDIR /build
RUN git init lila-ws && cd lila-ws \
 && git remote add origin https://github.com/WandererXII/lila-ws.git \
 && git fetch --depth 1 origin "$LILA_WS_COMMIT" && git checkout --detach FETCH_HEAD \
 && java -Xmx2g -jar /build/sbt-launch.jar stage
RUN git init shoginet && cd shoginet \
 && git remote add origin https://github.com/WandererXII/shoginet.git \
 && git fetch --depth 1 origin "$SHOGINET_COMMIT" && git checkout --detach FETCH_HEAD \
 && npm ci
RUN git init yaneuraou && cd yaneuraou \
 && git remote add origin https://github.com/yaneurao/YaneuraOu.git \
 && git fetch --depth 1 origin "$YANEURAOU_COMMIT" && git checkout --detach FETCH_HEAD \
 && cd source && make -j2 TARGET_CPU=SSE42 YANEURAOU_EDITION=YANEURAOU_ENGINE_NNUE COMPILER=g++ \
 && install -m 755 YaneuraOu-by-gcc /build/shoginet/engines/YaneuraOu-by-gcc
RUN git init fairy && cd fairy \
 && git remote add origin https://github.com/ianfab/Fairy-Stockfish.git \
 && git fetch --depth 1 origin "$FAIRY_COMMIT" && git checkout --detach FETCH_HEAD \
 && cd src && make -j2 build ARCH=x86-64 EXE=fairy-stockfish largeboards=yes \
 && install -m 755 fairy-stockfish /build/shoginet/engines/fairy-stockfish

FROM eclipse-temurin:21-jre-jammy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg nginx redis-server python3 \
 && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
      | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
 && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse' \
      > /etc/apt/sources.list.d/mongodb.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends mongodb-org-server mongodb-org-mongos mongodb-org-tools mongodb-mongosh \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/mongo /data/redis /run/lishogi /opt/lishogi/public-prod
COPY --from=build /build/lishogi/target/universal/stage /opt/lishogi/app
COPY --from=build /build/lishogi/public-prod /opt/lishogi/public-prod
COPY --from=build /build/lila-ws/target/universal/stage /opt/lila-ws
COPY --from=build /build/shoginet /opt/shoginet
COPY cloudflare/runtime /opt/cloudflare
COPY --from=build /build/lishogi/LICENSE /opt/cloudflare/licenses/lishogi-AGPL.txt
COPY --from=build /build/yaneuraou/LICENSE /opt/cloudflare/licenses/yaneuraou-GPL.txt
COPY --from=build /build/fairy/Copying.txt /opt/cloudflare/licenses/fairy-GPL.txt
ENV NODE_ENV=production
WORKDIR /opt/lishogi
EXPOSE 8080
ENTRYPOINT ["node", "/opt/cloudflare/control.mjs"]
