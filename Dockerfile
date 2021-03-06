FROM node:14-alpine
RUN apk add  --no-cache ffmpeg

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
CMD [ "npm", "run", "start" ]
