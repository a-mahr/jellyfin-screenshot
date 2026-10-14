FROM node:25-alpine
RUN apk add  --no-cache ffmpeg
RUN apk add --no-cache fontconfig ttf-dejavu

WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
CMD [ "pnpm", "run", "start" ]
